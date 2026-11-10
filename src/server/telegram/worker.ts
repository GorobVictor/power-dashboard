import { setTimeout as delay } from "node:timers/promises";
import type { Client } from "pg";
import { databaseClient } from "../db.ts";
import { createLogger, errorFields } from "../logger.ts";
import { sendTelegramMessage, TelegramSendError, type TelegramDestination, type TelegramMessage } from "./client.ts";

const idleMs = 2_000;
const log = createLogger("worker.telegram");

async function deliverPending(db: Client, destination: TelegramDestination, signal: AbortSignal) {
  let backoff = idleMs;
  while (!signal.aborted) {
    const { rows: [pending] } = await db.query<TelegramMessage & { id: string }>(
      'SELECT id, message AS text, parse_mode AS "parseMode" FROM telegram_outbox ORDER BY id LIMIT 1',
    );
    signal.throwIfAborted();
    if (!pending) {
      await delay(idleMs, undefined, { signal });
      continue;
    }

    try {
      await sendTelegramMessage(destination, pending, signal);
    } catch (error) {
      if (!(error instanceof TelegramSendError)) throw error;
      const retryInMs = Math.max(backoff, error.retryAfterMs);
      log.warn("Telegram delivery will retry", { outboxId: pending.id, reason: error.message, retryInMs });
      await delay(retryInMs, undefined, { signal });
      backoff = Math.min(backoff * 2, 60_000);
      continue;
    }
    await db.query("DELETE FROM telegram_outbox WHERE id = $1", [pending.id]);
    log.info("Delivered Telegram notification", { outboxId: pending.id });
    backoff = idleMs;
    await delay(1_100, undefined, { signal });
  }
}

export async function deliverTelegramNotifications(destination: TelegramDestination, shutdown: AbortSignal) {
  while (!shutdown.aborted) {
    const db = databaseClient("telegram-outbox");
    const disconnected = new AbortController();
    db.on("error", () => disconnected.abort());
    db.on("end", () => disconnected.abort());
    const signal = AbortSignal.any([shutdown, disconnected.signal]);
    try {
      await db.connect();
      signal.throwIfAborted();
      const { rows: [lock] } = await db.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended('telegram:outbox', 0)) AS acquired",
      );
      if (lock.acquired) {
        log.info("Starting Telegram delivery");
        await deliverPending(db, destination, signal);
      }
    } catch (error) {
      if (!shutdown.aborted) {
        log.warn("Telegram delivery interrupted", { ...errorFields(error), retryInMs: idleMs });
      }
    } finally {
      await db.end();
    }
    await delay(idleMs, undefined, { signal: shutdown }).catch((error) => {
      if (!shutdown.aborted) throw error;
    });
  }
}
