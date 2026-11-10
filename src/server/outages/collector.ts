import { setTimeout as delay } from "node:timers/promises";
import { databaseClient, databaseErrorMessage } from "../db.ts";
import { saveOutagePollWithTelegram } from "../telegram/outages.ts";
import { AlertsHttpError, fetchSchedules } from "./client.ts";
import { lockOutageSource, saveOutagePoll } from "./repository.ts";
import { AlertsSourceError } from "./schedules.ts";

const intervalMs = 60_000;

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
        console.info("Starting alerts.energy polling");
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
            console.warn("alerts.energy poll failed", error instanceof AlertsSourceError
              ? error.message : (error as Error).name);
          }
        }
      }
    } catch (error) {
      if (!shutdown.aborted) console.warn("alerts.energy collector interrupted", databaseErrorMessage(error));
    } finally {
      await db.end();
    }

    if (!shutdown.aborted) await delay(intervalMs, undefined, { signal: shutdown }).catch((error) => {
      if (!shutdown.aborted) throw error;
    });
  }
}
