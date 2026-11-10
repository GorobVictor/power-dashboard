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

  while (!shutdown.aborted) {
    const db = databaseClient();
    const disconnected = new AbortController();
    db.on("error", () => disconnected.abort());
    db.on("end", () => disconnected.abort());
    const signal = AbortSignal.any([shutdown, disconnected.signal]);

    try {
      await db.connect();
      signal.throwIfAborted();

      if (await lockOutageSource(db)) {
        log.info("Starting alerts.energy polling", { pollIntervalMs: intervalMs });
        while (!signal.aborted) {
          while (nextPoll > performance.now()) {
            await delay(Math.min(nextPoll - performance.now(), 2_147_483_647), undefined, { signal });
          }
          nextPoll = performance.now() + intervalMs;

          try {
            const schedules = await fetchSchedules(signal);
            signal.throwIfAborted();
            const observedAt = new Date();
            if (telegramQueue) await saveOutagePollWithTelegram(db, schedules, observedAt, telegramQueue);
            else await saveOutagePoll(db, schedules, observedAt);
          } catch (error) {
            if (signal.aborted) break;
            if (error instanceof AlertsHttpError && error.retryAfterMs > 0) {
              nextPoll = Math.max(nextPoll, performance.now() + error.retryAfterMs);
            }
            log.warn("alerts.energy poll failed", {
              ...errorFields(error),
              reason: error instanceof AlertsSourceError ? error.message : undefined,
              retryInMs: Math.max(0, Math.ceil(nextPoll - performance.now())),
            });
          }
        }
      }
    } catch (error) {
      if (!shutdown.aborted) {
        log.warn("alerts.energy collector interrupted", { ...errorFields(error), retryInMs: intervalMs });
      }
    } finally {
      await db.end();
    }

    if (!shutdown.aborted) await delay(intervalMs, undefined, { signal: shutdown }).catch((error) => {
      if (!shutdown.aborted) throw error;
    });
  }
}
