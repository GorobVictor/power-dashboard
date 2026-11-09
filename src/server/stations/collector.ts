import { setTimeout as delay } from "node:timers/promises";
import { databaseClient } from "../db.ts";
import { requestFrame, type ConnectStation } from "../marstek/client.ts";
import { decodeState, STATE } from "../marstek/protocol.ts";
import { lockStation, saveMeasurement } from "./repository.ts";
import type { CollectorStation } from "./types.ts";

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

async function collectWithLock(
  station: CollectorStation,
  connect: ConnectStation,
  interval: number,
  shutdown: AbortSignal,
  onSuccess: () => void,
) {
  const db = databaseClient();
  const dbLost = new AbortController();
  db.on("error", (error) => dbLost.abort(error));
  db.on("end", () => dbLost.abort(new Error("Station lock connection closed")));
  const signal = AbortSignal.any([shutdown, dbLost.signal]);

  try {
    await db.connect();
    signal.throwIfAborted();
    if (!await lockStation(db, station.id)) return;
    signal.throwIfAborted();

    const connection = await connect(station, signal);
    try {
      console.info("Connected to station", station.id);

      const session = AbortSignal.any([signal, connection.signal]);
      let nextAt = performance.now();
      for (;;) {
        const payload = await requestFrame(connection, STATE, session);
        const measuredAt = new Date();
        session.throwIfAborted();
        await saveMeasurement(db, station.id, { measuredAt, ...decodeState(payload) });
        onSuccess();

        nextAt += interval;
        const now = performance.now();
        if (nextAt < now) nextAt += Math.ceil((now - nextAt) / interval) * interval;
        await delay(Math.max(0, nextAt - now), undefined, { signal: session });
      }
    } finally {
      await connection.close();
    }
  } finally {
    await db.end();
  }
}

export async function collectStation(
  station: CollectorStation,
  connect: ConnectStation,
  interval: number,
  signal: AbortSignal,
) {
  let backoff = INITIAL_BACKOFF_MS;
  while (!signal.aborted) {
    try {
      await collectWithLock(station, connect, interval, signal, () => {
        backoff = INITIAL_BACKOFF_MS;
      });
    } catch (error) {
      if (signal.aborted) break;
      const reason = error instanceof Error ? error.cause ?? error : error;
      console.warn("Station polling interrupted", station.id, reason instanceof Error ? reason.message : reason);
    }
    if (signal.aborted) break;
    try {
      await delay(backoff, undefined, { signal });
    } catch (error) {
      if (signal.aborted) break;
      throw error;
    }
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  }
}
