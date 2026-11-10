import type { Metrics, SerializedMeasurement } from "../server/stations/types.ts";

const minute = 60_000;
const hour = 60 * minute;

export const telemetryPeriods = {
  "1h": { label: "1 год", duration: hour, bucket: 15_000 },
  "6h": { label: "6 год", duration: 6 * hour, bucket: minute },
  "24h": { label: "24 год", duration: 24 * hour, bucket: 5 * minute },
  "7d": { label: "7 днів", duration: 7 * 24 * hour, bucket: 30 * minute },
} as const;

export type TelemetryPeriod = keyof typeof telemetryPeriods;
export const defaultTelemetryPeriod: TelemetryPeriod = "1h";

export function isTelemetryPeriod(value: unknown): value is TelemetryPeriod {
  return typeof value === "string" && Object.hasOwn(telemetryPeriods, value);
}

export type TelemetrySample = Pick<Metrics, "socPct" | "batteryPowerW" | "gridPowerW" | "backupLoadPowerW"> & {
  time: number;
};

export type TelemetryHistory = { end: number; samples: TelemetrySample[] };

export function telemetrySample({ measuredAt, socPct, batteryPowerW, gridPowerW, backupLoadPowerW }: SerializedMeasurement): TelemetrySample {
  return { time: Date.parse(measuredAt), socPct, batteryPowerW, gridPowerW, backupLoadPowerW };
}

export function addTelemetrySample(history: TelemetryHistory, period: TelemetryPeriod, sample: TelemetrySample): TelemetryHistory {
  const { duration, bucket } = telemetryPeriods[period];
  const end = Math.max(history.end, sample.time);
  if (sample.time < end - duration) return history;
  const slot = Math.floor(sample.time / bucket);
  const existing = history.samples.find((point) => Math.floor(point.time / bucket) === slot);
  if (existing && existing.time >= sample.time) return history;
  const samples = history.samples.filter((point) => point !== existing && point.time >= end - duration);
  samples.push(sample);
  if ((samples.at(-2)?.time ?? 0) > sample.time) samples.sort((a, b) => a.time - b.time);
  return { end, samples };
}
