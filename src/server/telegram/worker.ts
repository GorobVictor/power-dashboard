import { setTimeout as delay } from "node:timers/promises";
import type { Client } from "pg";
import { databaseClient, databaseErrorMessage } from "../db.ts";
import { sendTelegramMessage, TelegramSendError, type TelegramDestination } from "./client.ts";

const idleMs = 2_000;

async function deliverPending(db: Client, destination: TelegramDestination, signal: AbortSignal) {
  let backoff = idleMs;
  while (!signal.aborted) {
    const { rows: [pending] } = await db.query<{ id: string; message: string }>(
      "SELECT id, message FROM telegram_outbox ORDER BY id LIMIT 1",
    );
    signal.throwIfAborted();
    if (!pending) {
      await delay(idleMs, undefined, { signal });
      continue;
    }

    try {
      await sendTelegramMessage(destination, pending.message, signal);
    } catch (error) {
      if (!(error instanceof TelegramSendError)) throw error;
      console.warn("Telegram delivery will retry", error.message);
      await delay(Math.max(backoff, error.retryAfterMs), undefined, { signal });
      backoff = Math.min(backoff * 2, 60_000);
      continue;
    }
    await db.query("DELETE FROM telegram_outbox WHERE id = $1", [pending.id]);
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
      if (lock.acquired) await deliverPending(db, destination, signal);
    } catch (error) {
      if (!shutdown.aborted) console.warn("Telegram delivery interrupted", databaseErrorMessage(error));
    } finally {
      await db.end();
    }
    await delay(idleMs, undefined, { signal: shutdown }).catch((error) => {
      if (!shutdown.aborted) throw error;
    });
  }
}
