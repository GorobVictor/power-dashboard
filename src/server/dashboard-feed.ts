import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import type { DashboardMessage, DashboardOutages, DashboardStation } from "../lib/dashboard-feed.ts";
import { databaseClient } from "./db.ts";
import { createLogger, errorFields } from "./logger.ts";
import { findCurrentSchedules, outageSourceId } from "./outages/repository.ts";
import { kyivDate } from "./outages/schedules.ts";
import { outageStaleAfterMs } from "./outages/service.ts";
import { findLatest } from "./stations/repository.ts";
import { stationStaleAfterMs } from "./stations/service.ts";
import type { SerializedMeasurement } from "./stations/types.ts";

type Update =
  | { type: "measurement"; stationId: string; measurement: SerializedMeasurement }
  | { type: "station"; stationId: string }
  | { type: "outages"; source: string; lastSuccessfulPollAt: string; schedulesChanged: boolean };

const channel = "power_dashboard_updates";
const log = createLogger("dashboard.feed");

export function dashboardFeed(publish: (message: DashboardMessage) => void, signal: AbortSignal) {
  const stationId = process.env.STATION_ID?.trim();
  const staleAfterMs = stationId ? stationStaleAfterMs() : 0;
  let station: DashboardStation | undefined = stationId ? undefined : { kind: "unconfigured" };
  let outages: DashboardOutages | undefined;
  let connected: boolean | undefined;

  function snapshot(send: typeof publish) {
    if (station) send({ type: "station", value: station });
    if (outages) send({ type: "outages", value: outages, schedulesChanged: true });
    if (connected !== undefined) send({ type: "status", connected, history: true });
  }

  async function listen() {
    let retryMs = 1_000;
    while (!signal.aborted) {
      const db = databaseClient("power-dashboard-feed");
      const lost = new AbortController();
      const stop = (error?: unknown) => lost.abort(error);
      const stopped = once(AbortSignal.any([signal, lost.signal]), "abort");
      db.on("error", stop);
      db.on("end", stop);

      async function readStation(): Promise<DashboardStation> {
        if (!stationId) return { kind: "unconfigured" };
        const latest = await findLatest(db, stationId);
        if (!latest) return { kind: "missing" };
        const { measurement } = latest;
        return {
          kind: "station", station: latest.station, staleAfterMs,
          measurement: measurement && { ...measurement, measuredAt: measurement.measuredAt.toISOString() },
        };
      }

      async function readOutages(): Promise<DashboardOutages> {
        const current = await findCurrentSchedules(db, kyivDate(new Date()), null);
        return {
          schedules: current.schedules.map((schedule) => ({ ...schedule, observedAt: schedule.observedAt.toISOString() })),
          lastSuccessfulPollAt: current.lastSuccessfulPollAt?.toISOString() ?? null,
          staleAfterMs: outageStaleAfterMs,
        };
      }

      let updates = Promise.resolve();
      db.on("notification", ({ channel: name, payload }) => {
        if (name !== channel || !payload) return;
        let update: Update;
        try {
          update = JSON.parse(payload) as Update;
        } catch {
          return;
        }
        updates = updates.then(async () => {
          if (lost.signal.aborted || signal.aborted) return;
          if (update?.type === "outages" && update.source === outageSourceId()) {
            const observedAt = Date.parse(update.lastSuccessfulPollAt);
            if (!Number.isFinite(observedAt)) return;
            if (!outages || update.schedulesChanged) {
              outages = await readOutages();
            } else {
              if (outages.lastSuccessfulPollAt && observedAt <= Date.parse(outages.lastSuccessfulPollAt)) return;
              outages = { ...outages, lastSuccessfulPollAt: update.lastSuccessfulPollAt };
            }
            publish({ type: "outages", value: outages, schedulesChanged: update.schedulesChanged });
          } else if (update?.type === "station" && update.stationId === stationId) {
            station = await readStation();
            publish({ type: "station", value: station });
          } else if (update?.type === "measurement" && update.stationId === stationId && station?.kind === "station") {
            const measuredAt = Date.parse(update.measurement?.measuredAt);
            if (!Number.isFinite(measuredAt) || (station.measurement && measuredAt <= Date.parse(station.measurement.measuredAt))) return;
            station = { ...station, measurement: update.measurement };
            publish({ type: "station", value: station });
          }
        }).catch(stop);
      });

      try {
        await db.connect();
        // Subscribe before loading snapshots so writes during startup are queued and applied afterward.
        updates = db.query(`LISTEN ${channel}`).then(async () => {
          const initialStation = await readStation();
          const initialOutages = await readOutages();
          station = initialStation;
          outages = initialOutages;
          connected = true;
          retryMs = 1_000;
          log.info("Dashboard PostgreSQL listener ready");
          snapshot(publish);
        });
        await updates;
        await stopped;
      } catch (error) {
        stop(error);
      } finally {
        await db.end().catch(() => undefined);
        await updates.catch(() => undefined);
      }

      if (signal.aborted) return;
      log.warn("Dashboard PostgreSQL listener disconnected", {
        ...errorFields(lost.signal.reason),
        retryInMs: retryMs,
      });
      connected = false;
      publish({ type: "status", connected, history: true });
      await delay(retryMs, undefined, { signal, ref: false }).catch(() => undefined);
      retryMs = Math.min(retryMs * 2, 30_000);
    }
  }

  void listen();
  return snapshot;
}
