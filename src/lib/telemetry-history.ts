import { timeZone } from "../server/outages/schedules.ts";
import type { Metrics, SerializedMeasurement } from "../server/stations/types.ts";

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;
const kyivOffset = new Intl.DateTimeFormat("en", { timeZone, timeZoneName: "longOffset" });

export const telemetryPeriods = {
  "1h": { label: "1 год", duration: hour, bucket: 15_000 },
  "6h": { label: "6 год", duration: 6 * hour, bucket: minute },
  "24h": { label: "24 год", duration: 24 * hour, bucket: 5 * minute },
  "7d": { label: "7 днів", duration: 7 * 24 * hour, bucket: 30 * minute },
} as const;

export type TelemetryPeriod = keyof typeof telemetryPeriods;
export type TelemetryDateRange = { from: string; to: string };
export type TelemetrySelection = { period: TelemetryPeriod } | ({ period: "dates" } & TelemetryDateRange);

export function isTelemetryPeriod(value: unknown): value is TelemetryPeriod {
  return typeof value === "string" && Object.hasOwn(telemetryPeriods, value);
}

export type TelemetrySample = Pick<Metrics, "socPct" | "batteryPowerW" | "gridPowerW" | "backupLoadPowerW"> & {
  time: number;
};

type TelemetryWindow = { start: number; end: number; bucket: number };
export type TelemetryHistory = TelemetryWindow & { samples: TelemetrySample[] };

export function shiftTelemetryDate(date: string, days: number) {
  return new Date(Date.parse(date) + days * day).toISOString().slice(0, 10);
}

function offsetAt(time: number) {
  const zone = kyivOffset.formatToParts(time).find(({ type }) => type === "timeZoneName")?.value;
  const [, sign, hours, minutes, seconds] = zone?.match(/^GMT([+-])(\d\d):(\d\d)(?::(\d\d))?$/) ?? [];
  return sign ? (sign === "-" ? -1 : 1) * (Number(hours) * hour + Number(minutes) * minute + Number(seconds ?? 0) * 1_000) : 0;
}

function kyivMidnight(utcMidnight: number) {
  return utcMidnight - offsetAt(utcMidnight - offsetAt(utcMidnight));
}

export function telemetryWindow(period: TelemetryPeriod | TelemetryDateRange, end = Date.now()): TelemetryWindow {
  if (typeof period === "string") {
    const { duration, bucket } = telemetryPeriods[period];
    return { start: end - duration, end, bucket };
  }

  const firstDay = Date.parse(period.from);
  const afterLastDay = Date.parse(period.to) + day;
  const days = (afterLastDay - firstDay) / day;
  const bucketMinutes = days === 1 ? 5 : days <= 3 ? 15 : 30 * Math.ceil(days / 7);
  return { start: kyivMidnight(firstDay), end: kyivMidnight(afterLastDay), bucket: bucketMinutes * minute };
}

export function telemetrySample({ measuredAt, socPct, batteryPowerW, gridPowerW, backupLoadPowerW }: SerializedMeasurement): TelemetrySample {
  return { time: Date.parse(measuredAt), socPct, batteryPowerW, gridPowerW, backupLoadPowerW };
}

export function addTelemetrySample(history: TelemetryHistory, period: TelemetrySelection["period"], sample: TelemetrySample): TelemetryHistory {
  const { bucket } = history;
  const { start, end } = period === "dates" ? history : telemetryWindow(period, Math.max(history.end, sample.time));
  if (sample.time < start || (period === "dates" && sample.time >= end)) return history;
  const slot = Math.floor(sample.time / bucket);
  const existing = history.samples.find((point) => Math.floor(point.time / bucket) === slot);
  if (existing && existing.time >= sample.time) return history;
  const samples = history.samples.filter((point) => point !== existing && point.time >= start);
  samples.push(sample);
  if ((samples.at(-2)?.time ?? 0) > sample.time) samples.sort((a, b) => a.time - b.time);
  return { start, end, bucket, samples };
}
