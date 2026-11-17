import type { DashboardSchedule } from "./dashboard-feed.ts";
import { telemetryWindow } from "./telemetry-history.ts";
import { scheduleBands, scheduleIntervals } from "../server/outages/intervals.ts";

export type ScheduleOverlayBand = { start: number; end: number; kind: "outage" | "possible" };

export function scheduleOverlayBands(schedules: DashboardSchedule[], start: number, end: number): ScheduleOverlayBand[] {
  return schedules.flatMap((schedule) => {
    const day = telemetryWindow({ from: schedule.date, to: schedule.date });
    if (day.end <= start || day.start >= end) return [];
    return scheduleBands(scheduleIntervals(schedule), day).flatMap((band) => {
      if (band.kind !== "outage" && band.kind !== "possible") return [];
      const from = Math.max(start, day.start + band.start * 60_000);
      const to = Math.min(end, day.start + band.end * 60_000);
      return from < to ? [{ start: from, end: to, kind: band.kind }] : [];
    });
  });
}
