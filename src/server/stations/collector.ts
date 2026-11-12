import { setTimeout as delay } from "node:timers/promises";
import { databaseClient } from "../db.ts";
import { createLogger, errorFields, errorMessage } from "../logger.ts";
import { requestFrame, type ConnectStation } from "../marstek/client.ts";
import { decodeState, decodeUpsEnabled, GET_WORK_MODE_SETTINGS, STATE } from "../marstek/protocol.ts";
import { readBatteryBaseline, saveBatteryReading, type BatteryNotificationOptions } from "../telegram/battery.ts";
import { lockStation, saveMeasurement } from "./repository.ts";
import type { CollectorStation } from "./types.ts";

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;
const UPS_POLL_INTERVAL_MS = 10_000;
const log = createLogger("worker.marstek");

async function collectWithLock(
  station: CollectorStation,
  connect: ConnectStation,
  interval: number,
  shutdown: AbortSignal,
  onSuccess: () => void,
  notifications: BatteryNotificationOptions | undefined,
) {
  const db = databaseClient();
  const dbLost = new AbortController();
  db.on("error", (error) => dbLost.abort(error));
  db.on("end", () => dbLost.abort(new Error("Station lock connection closed")));
  const signal = AbortSignal.any([shutdown, dbLost.signal]);
  let stage = "database.connect";

  try {
    await db.connect();
    signal.throwIfAborted();
    stage = "database.lock";
    if (!await lockStation(db, station.id)) return;
    stage = "database.load";
    let battery = notifications ? await readBatteryBaseline(db, station.id) : null;
    signal.throwIfAborted();

    stage = "ble.connect";
    const connection = await connect(station, signal);
    try {
      log.info("Connected to station", { stationId: station.id });

      const session = AbortSignal.any([signal, connection.signal]);
      let firstMeasurement = true;
      let nextAt = performance.now();
      let nextUpsPoll = 0;
      let upsEnabled: boolean | null = null;
      for (;;) {
        stage = "ble.read";
        const payload = await requestFrame(connection, STATE, session);
        const measuredAt = new Date();
        session.throwIfAborted();
        stage = "ble.decode";
        const metrics = decodeState(payload);
        if (metrics.workMode !== 1) {
          nextUpsPoll = 0;
          upsEnabled = null;
        } else if (performance.now() >= nextUpsPoll) {
          stage = "ble.readUps";
          try {
            upsEnabled = decodeUpsEnabled(await requestFrame(connection, GET_WORK_MODE_SETTINGS, session));
          } catch (error) {
            session.throwIfAborted();
            log.warn("BLE settings read failed", {
              stationId: station.id, stage: "ble.readUps", ...errorFields(error), reason: errorMessage(error),
            });
            await connection.diagnose?.();
            // A failed settings read should not discard the telemetry sample.
            upsEnabled = null;
          }
          nextUpsPoll = performance.now() + UPS_POLL_INTERVAL_MS;
        }
        const measurement = { measuredAt, ...metrics, upsEnabled };
        stage = "database.save";
        if (battery && notifications) {
          battery = await saveBatteryReading(db, station, measurement, battery, notifications);
        } else {
          await saveMeasurement(db, station.id, measurement);
        }
        onSuccess();
        if (firstMeasurement) {
          log.info("First BLE measurement processed", { stationId: station.id });
          firstMeasurement = false;
        }

        nextAt += interval;
        const now = performance.now();
        if (nextAt < now) nextAt += Math.ceil((now - nextAt) / interval) * interval;
        stage = "ble.wait";
        await delay(Math.max(0, nextAt - now), undefined, { signal: session });
      }
    } catch (error) {
      if (!signal.aborted && stage.startsWith("ble.")) await connection.diagnose?.();
      throw error;
    } finally {
      await connection.close();
    }
  } catch (error) {
    throw new Error(dbLost.signal.aborted ? "database.connection" : stage, { cause: error });
  } finally {
    await db.end();
  }
}

export async function collectStation(
  station: CollectorStation,
  connect: ConnectStation,
  interval: number,
  signal: AbortSignal,
  notifications?: BatteryNotificationOptions,
) {
  let backoff = INITIAL_BACKOFF_MS;
  while (!signal.aborted) {
    try {
      await collectWithLock(station, connect, interval, signal, () => {
        backoff = INITIAL_BACKOFF_MS;
      }, notifications);
    } catch (error) {
      if (signal.aborted) break;
      const stage = error instanceof Error && error.cause !== undefined ? error.message : "database.close";
      const failure = error instanceof Error ? error.cause ?? error : error;
      const reason = failure instanceof Error && failure.name === "AbortError" ? failure.cause ?? failure : failure;
      log.warn("Station polling interrupted", {
        stationId: station.id,
        stage,
        retryInMs: backoff,
        ...errorFields(reason),
        reason: stage.startsWith("ble.") ? errorMessage(reason) : undefined,
      });
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
