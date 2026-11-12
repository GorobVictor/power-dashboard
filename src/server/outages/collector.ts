import { setTimeout as delay } from "node:timers/promises";
import { databaseClient } from "../db.ts";
import { createLogger, errorFields } from "../logger.ts";
import { saveOutagePollWithTelegram } from "../telegram/outages.ts";
import { AlertsHttpError, fetchSchedules } from "./client.ts";
import { lockOutageSource, saveOutagePoll } from "./repository.ts";
import { AlertsSourceError } from "./schedules.ts";

const intervalMs = 60_000;
const log = createLogger("worker.outages");

export async function collectOutageSchedules(shutdown: AbortSignal, telegramQueue?: string) {
  let nextPoll = performance.now();
  let waitingForLock = false;

  while (!shutdown.aborted) {
    const db = databaseClient();
    const disconnected = new AbortController();
    db.on("error", (error) => disconnected.abort(error));
    db.on("end", () => disconnected.abort(new Error("PostgreSQL connection closed")));
    const signal = AbortSignal.any([shutdown, disconnected.signal]);
    let connectionStage = "database.connect";

    try {
      await db.connect();
      signal.throwIfAborted();

      connectionStage = "database.lock";
      if (await lockOutageSource(db)) {
        waitingForLock = false;
        connectionStage = "database.connection";
        log.info("Starting alerts.energy polling", { pollIntervalMs: intervalMs });
        while (!signal.aborted) {
          while (nextPoll > performance.now()) {
            await delay(Math.min(nextPoll - performance.now(), 2_147_483_647), undefined, { signal });
          }
          const startedAt = performance.now();
          nextPoll = startedAt + intervalMs;
          let stage = "source.fetch";

          try {
            const schedules = await fetchSchedules(signal);
            signal.throwIfAborted();
            stage = "database.save";
            const observedAt = new Date();
            const changes = telegramQueue
              ? await saveOutagePollWithTelegram(db, schedules, observedAt, telegramQueue)
              : await saveOutagePoll(db, schedules, observedAt);
            log.info("Saved alerts.energy poll", {
              schedules: schedules.length, changed: changes.length,
              durationMs: Math.round(performance.now() - startedAt),
            });
          } catch (error) {
            if (signal.aborted) break;
            const retryAfterMs = error instanceof AlertsHttpError ? error.retryAfterMs : 0;
            if (retryAfterMs > 0) nextPoll = Math.max(nextPoll, performance.now() + retryAfterMs);
            log.warn("alerts.energy poll failed", {
              stage,
              ...errorFields(error),
              reason: error instanceof AlertsSourceError ? error.message : undefined,
              retryAfterMs: retryAfterMs || undefined,
              retryInMs: Math.max(0, Math.ceil(nextPoll - performance.now())),
            });
          }
        }
      } else if (!waitingForLock) {
        log.info("Another worker holds the alerts.energy lock", { retryInMs: intervalMs });
        waitingForLock = true;
      }
      disconnected.signal.throwIfAborted();
    } catch (error) {
      if (!shutdown.aborted) {
        log.warn("alerts.energy collector interrupted", {
          stage: connectionStage, ...errorFields(error), retryInMs: intervalMs,
        });
      }
    } finally {
      await db.end();
    }

    if (!shutdown.aborted) await delay(intervalMs, undefined, { signal: shutdown }).catch((error) => {
      if (!shutdown.aborted) throw error;
    });
  }
}
