import type { Client, Pool } from "pg";
import { telemetryWindow, type TelemetryDateRange, type TelemetryHistory, type TelemetryPeriod } from "../../lib/telemetry-history.ts";
import type { CollectorStation, LatestMeasurement, Measurement, SerializedMeasurement, Station } from "./types.ts";

export async function registerStation(db: Client, station: CollectorStation) {
  const { rowCount } = await db.query(
    `INSERT INTO stations (id, name, model, device_id, ble_mac, collection_enabled)
     VALUES ($1, $2, $3, $4, $5, true)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, collection_enabled = true
     WHERE stations.model = EXCLUDED.model
       AND stations.device_id = EXCLUDED.device_id AND stations.ble_mac = EXCLUDED.ble_mac`,
    [station.id, station.name, station.model, station.deviceId, station.bleMac],
  );
  if (rowCount !== 1) throw new Error("Station ID already belongs to a different device");
}

export async function listEnabledStations(db: Client): Promise<CollectorStation[]> {
  const { rows } = await db.query<CollectorStation>(
    `SELECT id, name, model, device_id AS "deviceId", ble_mac AS "bleMac"
     FROM stations WHERE collection_enabled ORDER BY id`,
  );
  return rows;
}

export async function lockStation(db: Client, stationId: string): Promise<boolean> {
  const { rows } = await db.query<{ acquired: boolean }>(
    "SELECT pg_try_advisory_lock(hashtextextended('marstek:' || $1::text, 0)) AS acquired",
    [stationId],
  );
  return rows[0].acquired;
}

export async function saveMeasurement(db: Client, stationId: string, measurement: Measurement) {
  const { rowCount } = await db.query(
    `INSERT INTO measurements (
       station_id, measured_at, soc_pct, remaining_energy_wh,
       battery_power_w, grid_power_w, ac_output_power_w, backup_load_power_w,
       inverter_state, work_mode, daily_energy_in_wh, daily_energy_out_wh,
       monthly_energy_in_wh, monthly_energy_out_wh, total_energy_in_wh, total_energy_out_wh
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     ON CONFLICT (station_id, measured_at) DO NOTHING`,
    [
      stationId, measurement.measuredAt, measurement.socPct, measurement.remainingEnergyWh,
      measurement.batteryPowerW, measurement.gridPowerW, measurement.acOutputPowerW,
      measurement.backupLoadPowerW, measurement.inverterState, measurement.workMode,
      measurement.dailyEnergyInWh, measurement.dailyEnergyOutWh, measurement.monthlyEnergyInWh,
      measurement.monthlyEnergyOutWh, measurement.totalEnergyInWh, measurement.totalEnergyOutWh,
    ],
  );
  return rowCount === 1;
}

export async function findLatest(db: Pool | Client, stationId: string): Promise<LatestMeasurement | null> {
  const { rows } = await db.query<Station & { measurement: SerializedMeasurement | null }>(
    `SELECT s.id, s.name, s.model, m.measurement
     FROM stations s
     LEFT JOIN LATERAL (
       SELECT dashboard_measurement_json(latest) AS measurement FROM measurements latest
       WHERE station_id = s.id ORDER BY measured_at DESC LIMIT 1
     ) m ON true
     WHERE s.id = $1`,
    [stationId],
  );
  if (!rows.length) return null;
  const { measurement, ...station } = rows[0];
  return {
    station,
    measurement: measurement ? { ...measurement, measuredAt: new Date(measurement.measuredAt) } : null,
  };
}

export async function findTelemetryHistory(
  db: Pool | Client, stationId: string, period: TelemetryPeriod | TelemetryDateRange, now = Date.now(),
): Promise<TelemetryHistory> {
  const window = telemetryWindow(period, now);
  const { start, end, bucket } = window;
  const { rows } = await db.query<Omit<TelemetryHistory["samples"][number], "time"> & { measuredAt: Date }>(
    `WITH bounds AS (SELECT $2::timestamptz AS start_at, $3::timestamptz AS end_at, $4::interval AS step)
     SELECT measured_at AS "measuredAt", soc_pct AS "socPct", battery_power_w AS "batteryPowerW",
       grid_power_w AS "gridPowerW", backup_load_power_w AS "backupLoadPowerW"
     FROM bounds
     CROSS JOIN LATERAL generate_series(
       date_bin(step, start_at, '1970-01-01 UTC'::timestamptz), end_at, step
     ) AS bucket(start_at)
     CROSS JOIN LATERAL (
       SELECT measured_at, soc_pct, battery_power_w, grid_power_w, backup_load_power_w
       FROM measurements
       WHERE station_id = $1 AND measured_at >= GREATEST(bounds.start_at, bucket.start_at)
         AND measured_at < bucket.start_at + step AND measured_at <= end_at
         AND (measured_at <> end_at OR $5::boolean)
       ORDER BY measured_at DESC LIMIT 1
     ) AS latest
     ORDER BY bucket.start_at`,
    [stationId, new Date(start), new Date(end), `${bucket / 1000} seconds`, typeof period === "string"],
  );
  return { ...window, samples: rows.map(({ measuredAt, ...metrics }) => ({ time: measuredAt.getTime(), ...metrics })) };
}
