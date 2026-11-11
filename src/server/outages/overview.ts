import { shiftTelemetryDate, type TelemetryHistory } from "../../lib/telemetry-history.ts";
import { database } from "../db.ts";
import { createLogger, errorFields } from "../logger.ts";
import { findTelemetryHistory } from "../stations/repository.ts";
import { clockTime, kyivMinute, outageIntervals, scheduleBands, scheduleIntervals } from "./intervals.ts";
import { kyivDate, type ScheduleContent } from "./schedules.ts";
import { getCurrentOutages } from "./service.ts";

const log = createLogger("api.outages.overview");
const emptySchedule: ScheduleContent = {
  status: "WaitingForSchedule", hours: [], possible: [], publishedSchedule: null,
};

async function readDashboardCharge(date: string, now: number) {
  const stationId = process.env.STATION_ID?.trim();
  return stationId ? findTelemetryHistory(database(), stationId, { from: date, to: date }, now) : null;
}

function chargePlot(history: TelemetryHistory | null, now: number, intervals: ReturnType<typeof scheduleIntervals>) {
  if (!history) return null;
  const { start, end, bucket } = history;
  const duration = (end - start) / 60_000;
  const points: { minute: number; socPct: number | null }[] = [];
  let last: { minute: number; socPct: number; time: string } | null = null;
  let previousSlot = -Infinity;
  for (const { time, socPct } of history.samples) {
    if (time > now || socPct === null) continue;
    const minute = (time - start) / 60_000;
    const slot = Math.floor(time / bucket);
    if (last && slot > previousSlot + 1) points.push({ minute: (last.minute + minute) / 2, socPct: null });
    points.push({ minute, socPct });
    last = { minute, socPct, time: clockTime(kyivMinute(time)) };
    previousSlot = slot;
  }
  if (!last) return null;
  return {
    duration, points, last, now: (now - start) / 60_000,
    bands: scheduleBands(intervals, history),
    ticks: [0, 0.25, 0.5, 0.75].map((fraction) => clockTime(kyivMinute(start + (end - start) * fraction))).concat("24:00"),
  };
}

export async function getOutageOverview(
  queue: string, now: Date, readOutages = getCurrentOutages, readCharge = readDashboardCharge,
) {
  const today = kyivDate(now);
  const tomorrow = shiftTelemetryDate(today, 1);
  const time = now.getTime();
  const [current, history] = await Promise.all([
    readOutages(queue, now),
    readCharge(today, time).catch((error) => {
      log.error("Unable to read charge history for outage overview", errorFields(error));
      return null;
    }),
  ]);
  const schedules = new Map(current.schedules.map((schedule) => [schedule.date, schedule]));
  const dates = [today, tomorrow, ...[...schedules.keys()].filter((date) => date > tomorrow).sort()];
  const minute = kyivMinute(time);
  const todayIntervals = scheduleIntervals(schedules.get(today) ?? emptySchedule);
  const days = dates.map((date) => {
    const schedule = schedules.get(date);
    const intervals = date === today ? todayIntervals : scheduleIntervals(schedule ?? emptySchedule);
    const next = date === today && !current.stale && schedule?.status === "ScheduleApplies"
      ? outageIntervals(schedule.hours).find(({ end }) => end > minute)
      : undefined;
    return {
      date,
      status: schedule?.status ?? null,
      intervals: intervals.map(({ start, end, kind }) => ({ start, end, kind, range: `${clockTime(start)}–${clockTime(end)}` })),
      next: next ? { ongoing: next.start <= minute, range: `${clockTime(next.start)}–${clockTime(next.end)}` } : null,
    };
  });
  return {
    today, tomorrow, days, timeZone: current.timeZone,
    lastSuccessfulPollAt: current.lastSuccessfulPollAt, stale: current.stale,
    charge: chargePlot(history, time, todayIntervals),
  };
}
