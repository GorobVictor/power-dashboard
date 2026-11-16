import { execFile } from "node:child_process";
import { isIP } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import type { Client } from "pg";
import { positiveInteger } from "../config.ts";
import { databaseClient, inTransaction } from "../db.ts";
import { createLogger, errorFields } from "../logger.ts";
import { enqueueTelegramMessages } from "../telegram/outbox.ts";

export type PowerStatus = "online" | "offline" | "unknown";
export type State = { status: PowerStatus; lastKnownStatus: "online" | "offline" | null; checkedAt: Date };
const log = createLogger("worker.power");

export function nextPollAt(previous: number, now: number, interval: number): number {
  return Math.max(previous + interval, now);
}

export function ping(ip: string, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const args = process.platform === "darwin" ? ["-n", "-c", "1", "-W", "1000", ip] : ["-n", "-c", "1", "-W", "1", ip];
    execFile("ping", args, { signal, timeout: 3_000 }, (error, stdout, stderr) => {
      if (!error) return resolve(true);
      if (signal.aborted) return reject(signal.reason);
      const detail = `${stdout} ${stderr}`;
      if (typeof error.code === "number" && error.code === 1 && !/operation not permitted|permission denied|cannot create|invalid argument/i.test(detail)) return resolve(false);
      reject(new Error(`ping failed: ${stderr.trim() || error.message}`));
    });
  });
}

async function readState(db: Client): Promise<State | undefined> {
  const { rows } = await db.query<State>(`SELECT status, last_known_status AS "lastKnownStatus", checked_at AS "checkedAt" FROM power_monitor_state WHERE id`);
  return rows[0];
}

export async function savePowerState(db: Client, previous: State | undefined, status: PowerStatus, at: Date, notify: boolean, eventAt = at, staleAfterMs = 30_000, successful = false) {
  const changed = !previous || previous.status !== status;
  const known = status === "unknown" ? previous?.lastKnownStatus ?? null : status;
  await inTransaction(db, async () => {
    if (changed) await db.query("INSERT INTO power_monitor_events (status, observed_at) VALUES ($1, $2)", [status, eventAt]);
    await db.query(`INSERT INTO power_monitor_state (id, status, last_known_status, checked_at, stale_after_ms, last_online_at, last_offline_at)
      VALUES (true, $1, $2, $3, $4, CASE WHEN $5 THEN $3 END, CASE WHEN $1 = 'offline' THEN $3 END)
      ON CONFLICT (id) DO UPDATE SET status = $1, last_known_status = $2, checked_at = $3, stale_after_ms = $4,
      last_online_at = CASE WHEN $5 THEN $3 ELSE power_monitor_state.last_online_at END,
      last_offline_at = CASE WHEN $1 = 'offline' AND power_monitor_state.last_known_status IS DISTINCT FROM 'offline' THEN $3 ELSE power_monitor_state.last_offline_at END`, [status, known, at, staleAfterMs, successful]);
    if (notify && status !== "unknown" && previous?.lastKnownStatus && previous.lastKnownStatus !== status) {
      await enqueueTelegramMessages(db, [status === "online" ? "⚡ *Світло, ймовірно, зʼявилося*\nРозетка знову відповідає на ping\\." : "🔌 *Світло, ймовірно, зникло*\nРозетка не відповідає на ping\\."]);
    }
    await db.query("SELECT pg_notify('power_dashboard_updates', $1)", [JSON.stringify({ type: "power" })]);
  });
  return { status, lastKnownStatus: known, checkedAt: at } satisfies State;
}

export async function collectPower(shutdown: AbortSignal, notify: boolean) {
  const ip = process.env.POWER_MONITOR_IP?.trim();
  if (!ip) return;
  if (isIP(ip) !== 4) throw new Error("POWER_MONITOR_IP must be an IPv4 address");
  const interval = positiveInteger("POWER_POLL_INTERVAL_MS", 1_000);
  const staleAfterMs = Math.min(2_147_483_647, interval * 2 + 6_000);
  while (!shutdown.aborted) {
    const db = databaseClient("power-monitor");
    const disconnected = new AbortController();
    db.on("error", (error) => disconnected.abort(error));
    db.on("end", () => disconnected.abort());
    const signal = AbortSignal.any([shutdown, disconnected.signal]);
    try {
      await db.connect();
      const { rows: [lock] } = await db.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock(hashtextextended('power:monitor', 0)) AS acquired");
      if (lock.acquired) {
        let state = await readState(db);
        if (state && state.status !== "unknown") {
          const unknownAt = new Date(Math.min(Date.now(), state.checkedAt.getTime() + staleAfterMs));
          state = await savePowerState(db, state, "unknown", new Date(), false, unknownAt, staleAfterMs);
        }
        let nextPoll = performance.now();
        while (!signal.aborted) {
          let result: boolean | null;
          try { result = await ping(ip, signal); }
          catch (error) {
            signal.throwIfAborted();
            log.warn("Ping unavailable", errorFields(error));
            result = null;
          }
          const at = new Date();
          if (result === null) {
            state = await savePowerState(db, state, "unknown", at, false, at, staleAfterMs);
          } else {
            const status = result ? "online" : "offline";
            if (state?.status !== status) {
              if (result) log.info("Socket is responding", { ip });
              else log.warn("Socket is not responding", { ip });
            }
            state = await savePowerState(db, state, status, at, notify, at, staleAfterMs, result);
          }
          const now = performance.now();
          nextPoll = nextPollAt(nextPoll, now, interval);
          await delay(Math.max(0, nextPoll - now), undefined, { signal });
        }
      }
    } catch (error) {
      if (!shutdown.aborted) log.warn("Power monitor interrupted", errorFields(error));
    } finally {
      await db.end().catch(() => undefined);
    }
    await delay(2_000, undefined, { signal: shutdown }).catch(() => undefined);
  }
}
