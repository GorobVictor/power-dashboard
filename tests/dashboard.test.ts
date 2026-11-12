import assert from "node:assert/strict";
import test from "node:test";
import { dischargeMinutes, formatDischargeTime } from "../src/app/dashboard/battery-runtime.ts";
import { clockTime, outageIntervals, scheduleIntervals } from "../src/server/outages/intervals.ts";
import { addTelemetrySample, shiftTelemetryDate, telemetryWindow } from "../src/lib/telemetry-history.ts";
import {
  createDashboardSession,
  dashboardAuthConfig,
  isDashboardSessionValid,
  sessionCookieOptions,
} from "../src/server/dashboard-session.ts";

test("dashboard sessions expire, reject tampering, and follow credential rotation", async () => {
  process.env.API_USERNAME = "dashboard";
  process.env.API_PASSWORD = "fixture-password";
  process.env.DASHBOARD_SESSION_SECRET = "a".repeat(64);
  const config = dashboardAuthConfig();
  assert.ok(config);

  const now = Date.now();
  const session = await createDashboardSession(config.key, now);
  const middle = Math.floor(session.length / 2);
  const tampered = session.slice(0, middle) + (session[middle] === "a" ? "b" : "a") + session.slice(middle + 1);
  assert.equal(await isDashboardSessionValid(session, config.key, now), true);
  assert.equal(await isDashboardSessionValid(undefined, config.key, now), false);
  assert.equal(await isDashboardSessionValid(tampered, config.key, now), false);
  assert.equal(await isDashboardSessionValid(session, config.key, now + 8 * 60 * 60 * 1_000), false);

  process.env.API_PASSWORD = "rotated-password";
  const rotated = dashboardAuthConfig();
  assert.ok(rotated);
  assert.equal(await isDashboardSessionValid(session, rotated.key, now), false);

  process.env.API_PASSWORD = "fixture-password";
  process.env.DASHBOARD_SESSION_SECRET = "b".repeat(64);
  const rekeyed = dashboardAuthConfig();
  assert.ok(rekeyed);
  assert.equal(await isDashboardSessionValid(session, rekeyed.key, now), false);

  process.env.DASHBOARD_SESSION_SECRET = "short";
  assert.equal(dashboardAuthConfig(), null);
  process.env.DASHBOARD_SECURE_COOKIE = "true";
  assert.deepEqual(sessionCookieOptions(), { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 28_800 });
  process.env.DASHBOARD_SECURE_COOKIE = "false";
  assert.equal(sessionCookieOptions().secure, false);
});

test("outage intervals respect half-hour boundaries and merge only matching adjacent intervals", () => {
  assert.deepEqual(outageIntervals([0, 3, 1, 2, 9, 9, 0, 2, 3]), [
    { start: 90, end: 210, kind: "planned" },
    { start: 240, end: 360, kind: "emergency" },
    { start: 420, end: 450, kind: "planned" },
    { start: 510, end: 540, kind: "planned" },
  ]);
  assert.deepEqual(outageIntervals([]), []);
  assert.equal(clockTime(90), "01:30");
  assert.equal(clockTime(1_440), "24:00");
});

test("expected power excludes planned and possible outages at half-hour boundaries", () => {
  assert.deepEqual(scheduleIntervals({
    status: "ScheduleApplies", hours: [2, 3, 9, ...Array<0>(21).fill(0)], possible: [0, 2, 1, 3],
  }), [
    { start: 0, end: 30, kind: "outage" },
    { start: 30, end: 60, kind: "power" },
    { start: 60, end: 90, kind: "possible" },
    { start: 90, end: 180, kind: "outage" },
    { start: 180, end: 210, kind: "power" },
    { start: 210, end: 240, kind: "possible" },
    { start: 240, end: 1_440, kind: "power" },
  ]);
});

test("expected power requires a known schedule or a no-outages status", () => {
  for (const status of ["WaitingForSchedule", "ScheduleApplies", "EmergencyShutdowns"] as const) {
    assert.deepEqual(scheduleIntervals({ status, hours: [], possible: [] }), [
      { start: 0, end: 1_440, kind: "unknown" },
    ]);
  }
  assert.deepEqual(scheduleIntervals({ status: "NoShutdowns", hours: [], possible: [] }), [
    { start: 0, end: 1_440, kind: "power" },
  ]);
});

test("telemetry calendar windows follow Kyiv midnight across clock changes", () => {
  const spring = telemetryWindow({ from: "2026-03-29", to: "2026-03-29" });
  assert.equal(spring.start, Date.parse("2026-03-28T22:00:00Z"));
  assert.equal(spring.end, Date.parse("2026-03-29T21:00:00Z"));

  const autumn = telemetryWindow({ from: "2026-10-24", to: "2026-10-25" });
  assert.equal(autumn.start, Date.parse("2026-10-23T21:00:00Z"));
  assert.equal(autumn.end, Date.parse("2026-10-25T22:00:00Z"));
  assert.equal(shiftTelemetryDate("2026-01-01", -1), "2025-12-31");
});

test("live telemetry leaves fixed calendar bounds in place", () => {
  const history = { ...telemetryWindow({ from: "2026-01-01", to: "2026-01-01" }), samples: [] };
  const sample = { time: history.start, socPct: 0, batteryPowerW: null, gridPowerW: null, backupLoadPowerW: null };
  const updated = addTelemetrySample(history, "dates", sample);
  assert.deepEqual(updated, { ...history, samples: [sample] });
  assert.equal(addTelemetrySample(updated, "dates", { ...sample, time: history.end }), updated);
  assert.equal(addTelemetrySample(updated, "dates", { ...sample, time: history.start - 1 }), updated);
});

test("discharge estimate uses remaining energy and battery draw and preserves zero", () => {
  assert.equal(dischargeMinutes(3_660, -510), 3_660 / 510 * 60);
  assert.equal(formatDischargeTime(dischargeMinutes(4_680, -150)!), "≈ 1 дн 7 год");
  assert.equal(formatDischargeTime(119.6), "≈ 2 год 0 хв");
  assert.equal(formatDischargeTime(0.5), "< 1 хв");
  assert.equal(dischargeMinutes(0, -150), 0);
  assert.equal(dischargeMinutes(null, -150), null);
  assert.equal(dischargeMinutes(4_680, null), null);
  assert.equal(dischargeMinutes(4_680, 0), null);
  assert.equal(dischargeMinutes(4_680, 150), null);
});

test("schedule comparison distinguishes interval changes and incomplete schedules", async () => {
  const { compareSchedules } = await import("../src/app/dashboard/schedule-insights.ts");
  const previous = { status: "ScheduleApplies" as const, hours: Array.from({ length: 24 }, (_, i) => i === 1 ? 1 as const : 0 as const), possible: [], publishedSchedule: null };
  const current = { ...previous, hours: Array.from({ length: 24 }, (_, i) => i === 2 || i === 3 ? 1 as const : 0 as const) };
  const changes = compareSchedules(previous, current);
  assert.match(changes[0], /більше на 1 год 0 хв/);
  assert.match(changes[1], /було 01:00–02:00; стало 02:00–04:00/);
  const unknown = { ...current, status: "EmergencyShutdowns" as const, hours: [] };
  assert.ok(compareSchedules(previous, unknown).every((change) => !change.includes("більше на") && !change.includes("менше на")));
});
