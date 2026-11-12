import { setTimeout as delay } from "node:timers/promises";
import { databaseClient } from "../db.ts";
import { createLogger, errorFields } from "../logger.ts";
import { saveOutagePollWithTelegram } from "../telegram/outages.ts";
import { DtekBrowser, DtekError } from "./dtek.ts";
import { enqueueTelegramMessages } from "../telegram/outbox.ts";
import { escapeMarkdown } from "../telegram/markdown.ts";
import { lockOutageSource, saveOutagePoll } from "./repository.ts";

const intervalMs = 60_000;
const log = createLogger("worker.outages");

export async function collectDtekSchedules(shutdown: AbortSignal, telegramQueue?: string, telegramEnabled = false) {
  const browser = new DtekBrowser(process.env.DTEK_WEBDRIVER_URL || "http://selenium:4444");
  let challengeNotified = false;
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
        log.info("Starting DTEK polling", { pollIntervalMs: intervalMs });
        while (!signal.aborted) {
          while (nextPoll > performance.now()) {
            await delay(Math.min(nextPoll - performance.now(), 2_147_483_647), undefined, { signal });
          }
          const startedAt = performance.now();
          nextPoll = startedAt + intervalMs;
          let stage = "source.fetch";

          try {
            const result = await browser.poll();
            if (result.challenge) {
              if (!challengeNotified && telegramEnabled) {
                const url = process.env.DTEK_BROWSER_URL;
                if (url) {
                  await enqueueTelegramMessages(db, [`Потрібно пройти перевірку ДТЕК: ${escapeMarkdown(url)}`]);
                  challengeNotified = true;
                } else log.warn("Set DTEK_BROWSER_URL to send a CAPTCHA link");
              }
              continue;
            }
            challengeNotified = false;
            const schedules = result.schedules;
            signal.throwIfAborted();
            stage = "database.save";
            const observedAt = new Date();
            const changes = telegramQueue
              ? await saveOutagePollWithTelegram(db, schedules, observedAt, telegramQueue)
              : await saveOutagePoll(db, schedules, observedAt);
            log.info("Saved DTEK poll", {
              schedules: schedules.length, changed: changes.length,
              durationMs: Math.round(performance.now() - startedAt),
            });
          } catch (error) {
            if (signal.aborted) break;
            log.warn("DTEK poll failed", {
              stage,
              ...errorFields(error),
              reason: error instanceof DtekError ? error.message : undefined,
              retryInMs: Math.max(0, Math.ceil(nextPoll - performance.now())),
            });
          }
        }
      } else if (!waitingForLock) {
        log.info("Another worker holds the DTEK lock", { retryInMs: intervalMs });
        waitingForLock = true;
      }
      disconnected.signal.throwIfAborted();
    } catch (error) {
      if (!shutdown.aborted) {
        log.warn("DTEK collector interrupted", {
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
