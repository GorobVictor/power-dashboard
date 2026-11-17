import { powerIntervals } from "../../lib/power-history.ts";
import { shiftTelemetryDate, telemetryWindow, type TelemetryHistory } from "../../lib/telemetry-history.ts";
import { database } from "../db.ts";
import { createLogger, errorFields } from "../logger.ts";
import { readPower } from "../power/repository.ts";
import { powerStatus } from "../power/service.ts";
import { findTelemetryHistory } from "../stations/repository.ts";
import { clockTime, kyivMinute, outageIntervals, scheduleBands, scheduleIntervals } from "./intervals.ts";
import { kyivDate, type ScheduleContent, type ScheduleVersion } from "./schedules.ts";
import { findLatestScheduleVersions } from "./repository.ts";
import { getCurrentOutages } from "./service.ts";

const log = createLogger("api.outages.overview");
const emptySchedule: ScheduleContent = {
  status: "WaitingForSchedule", hours: [], possible: [], publishedSchedule: null,
};

async function readDashboardCharge(date: string, now: number) {
  const stationId = process.env.STATION_ID?.trim();
  return stationId ? findTelemetryHistory(database(), stationId, { from: date, to: date }, now) : null;
}

async function readYesterday(queue: string, date: string, now: number): Promise<{ schedule: ScheduleVersion | null; charge: TelemetryHistory | null } | null> {
  const [schedules, charge] = await Promise.all([
    findLatestScheduleVersions(database(), date, date, queue), readDashboardCharge(date, now),
  ]);
  return { schedule: schedules[0] ?? null, charge };
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
  readObservedPower = () => readPower(database()), readPreviousDay = readYesterday,
) {
  const today = kyivDate(now);
  const tomorrow = shiftTelemetryDate(today, 1);
  const yesterday = shiftTelemetryDate(today, -1);
  const time = now.getTime();
  const [current, history, observed, previous] = await Promise.all([
    readOutages(queue, now),
    readCharge(today, time).catch((error) => {
      log.error("Unable to read charge history for outage overview", errorFields(error));
      return null;
    }),
    readObservedPower().catch((error) => {
      log.error("Unable to read power history for outage overview", errorFields(error));
      return null;
    }),
    readPreviousDay(queue, yesterday, time).catch((error) => {
      log.error("Unable to read yesterday for outage overview", errorFields(error));
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
  function observedFor(date: string) {
    const window = telemetryWindow({ from: date, to: date });
    const bands = observed ? powerIntervals(observed.events, window.start, window.end, time, observed.checkedAt, observed.staleAfterMs)
      .map((band) => ({ start: (band.start - window.start) / 60_000, end: (band.end - window.start) / 60_000, kind: band.status })) : [];
    return { current: powerStatus(observed, time), duration: (window.end - window.start) / 60_000, bands };
  }
  function chartFor(data: TelemetryHistory | null, intervals: ReturnType<typeof scheduleIntervals>, bands: ReturnType<typeof observedFor>["bands"]) {
    const charge = chargePlot(data, time, intervals);
    return charge ? {
      ...charge,
      backgrounds: [
        ...charge.bands.map((band) => ({ ...band, layer: "schedule" as const })),
        ...bands.map((band) => ({ ...band, layer: "power" as const })),
      ],
    } : null;
  }
  const observedToday = observedFor(today);
  const charge = chartFor(history, todayIntervals, observedToday.bands);
  const previousIntervals = scheduleIntervals(previous?.schedule ?? emptySchedule);
  const previousPower = observedFor(yesterday);
  const previousDay = {
    date: yesterday, status: previous?.schedule?.status ?? null,
    intervals: previousIntervals.map(({ start, end, kind }) => ({ start, end, kind, range: `${clockTime(start)}–${clockTime(end)}` })),
    next: null, charge: chartFor(previous?.charge ?? null, previousIntervals, previousPower.bands), power: previousPower,
  };
  return {
    today, tomorrow, days, timeZone: current.timeZone,
    lastSuccessfulPollAt: current.lastSuccessfulPollAt, stale: current.stale,
    charge, power: observedToday,
    widgetDays: [previousDay, ...days.map((day) => ({ ...day, charge: day.date === today ? charge : null, power: day.date === today ? observedToday : null }))],
  };
}
