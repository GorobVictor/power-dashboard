import assert from "node:assert/strict";
import test from "node:test";
import { dischargeMinutes, formatDischargeTime } from "../src/app/dashboard/battery-runtime.ts";
import { clockTime, outageIntervals } from "../src/server/outages/intervals.ts";
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
