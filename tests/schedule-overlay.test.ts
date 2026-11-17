import assert from "node:assert/strict";
import test from "node:test";
import type { DashboardSchedule } from "../src/lib/dashboard-feed.ts";
import { scheduleOverlayBands } from "../src/lib/schedule-overlay.ts";
import { telemetryWindow } from "../src/lib/telemetry-history.ts";

function schedule(date: string, outageHour: number): DashboardSchedule {
  const hours: DashboardSchedule["hours"] = Array(24).fill(0);
  hours[outageHour] = 1;
  return { date, queue: "4.1", observedAt: new Date().toISOString(), status: "ScheduleApplies", hours, possible: [], publishedSchedule: null };
}

test("schedule bands join days, clip to the chart and preserve missing dates", () => {
  const first = telemetryWindow({ from: "2026-11-14", to: "2026-11-14" });
  const third = telemetryWindow({ from: "2026-11-16", to: "2026-11-16" });
  const start = first.start + 8.5 * 3_600_000;
  const end = third.start + 10 * 3_600_000;
  assert.deepEqual(scheduleOverlayBands([schedule("2026-11-14", 8), schedule("2026-11-16", 9)], start, end), [
    { start, end: first.start + 9 * 3_600_000, kind: "outage" },
    { start: third.start + 9 * 3_600_000, end, kind: "outage" },
  ]);
});

test("schedule bands respect Kyiv daylight saving changes", () => {
  const day = telemetryWindow({ from: "2026-03-29", to: "2026-03-29" });
  assert.equal(day.end - day.start, 23 * 3_600_000);
  const bands = scheduleOverlayBands([schedule("2026-03-29", 6)], day.start, day.end);
  assert.deepEqual(bands, [{ start: Date.parse("2026-03-29T03:00:00Z"), end: Date.parse("2026-03-29T04:00:00Z"), kind: "outage" }]);
});
