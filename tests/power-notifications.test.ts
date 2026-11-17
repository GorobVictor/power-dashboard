import assert from "node:assert/strict";
import test from "node:test";
import type { ScheduleVersion } from "../src/server/outages/schedules.ts";
import { durationText, powerMessage, powerScheduleDetails } from "../src/server/telegram/power.ts";

const date = "2026-11-16";
const queue = "4.1";
const at = (hour: number, minute = 0) => new Date(Date.UTC(2026, 10, 16, hour - 2, minute));
const schedule = (date: string, hours: ScheduleVersion["hours"], possible: ScheduleVersion["possible"] = []): ScheduleVersion => ({
  date, queue, status: "ScheduleApplies", hours, possible, publishedSchedule: null, observedAt: at(0),
});

test("power notifications show elapsed time and do not invent missing durations", () => {
  assert.equal(durationText(90_061_000), "1 дн 1 год 1 хв 1 с");
  assert.match(powerMessage("online", at(12), at(10, 30), []), /Без світла: щонайменше 1 год 30 хв/);
  assert.match(powerMessage("offline", at(12), at(11, 59), []), /Зі світлом: щонайменше 1 хв/);
  assert.match(powerMessage("online", at(12), null, []), /Без світла: тривалість невідома/);
  assert.match(powerMessage("offline", at(12), at(13), []), /Зі світлом: тривалість невідома/);
  assert.match(powerMessage("online", at(12), null, ["Черга 4.1: світло."]), /Черга 4\\\.1: світло\\\./);
  for (const status of ["online", "offline"] as const) {
    assert.match(powerMessage(status, at(12), null, [], 0), /Заряд станції: \*0%\*/);
    assert.match(powerMessage(status, at(12), null, [], 81), /Заряд станції: \*81%\*/);
    assert.match(powerMessage(status, at(12), null, [], null), /Заряд станції: немає актуальних даних/);
  }
});

test("schedule context reports current plan and next transition including half hours", () => {
  const hours: ScheduleVersion["hours"] = Array(24).fill(0);
  hours[12] = 3; hours[13] = 2;
  const plans = [schedule(date, hours)];
  assert.deepEqual(powerScheduleDetails(queue, at(12, 15), plans, false), [
    "📅 Черга 4.1: за графіком зараз має бути світло.", "Наступне відключення за графіком о 12:30.",
  ]);
  assert.deepEqual(powerScheduleDetails(queue, at(12, 45), plans, false), [
    "📅 Черга 4.1: за графіком зараз відключення.", "Поява світла за графіком о 13:30.",
  ]);
});

test("schedule context handles possible outages, midnight, missing and stale data", () => {
  const hours: ScheduleVersion["hours"] = Array(24).fill(0);
  const possible: ScheduleVersion["possible"] = Array(24).fill(0); possible[12] = 3;
  assert.deepEqual(powerScheduleDetails(queue, at(12, 40), [schedule(date, hours, possible)], false), [
    "📅 Черга 4.1: зараз можливе відключення.", "Період можливого відключення за графіком триває до 13:00.",
  ]);
  const tomorrowHours: ScheduleVersion["hours"] = Array(24).fill(0); tomorrowHours[1] = 1;
  assert.deepEqual(powerScheduleDetails(queue, at(23), [schedule(date, hours), schedule("2026-11-17", tomorrowHours)], false), [
    "📅 Черга 4.1: за графіком зараз має бути світло.", "Наступне відключення за графіком завтра о 01:00.",
  ]);
  assert.match(powerScheduleDetails(queue, at(12), [], true)[0], /застарів/);
  assert.match(powerScheduleDetails(queue, at(12), [], null)[0], /недоступний/);
  assert.match(powerScheduleDetails(undefined, at(12), [], null)[0], /не налаштовано/);
  const emergency = { ...schedule(date, hours), status: "EmergencyShutdowns" as const };
  assert.match(powerScheduleDetails(queue, at(12), [emergency], false)[0], /аварійні/);
  const incomplete = schedule(date, []);
  assert.match(powerScheduleDetails(queue, at(12), [incomplete], false)[0], /невідомий/);
});

test("power transition uses the last continuous event and queues the message atomically", async () => {
  const { savePowerState } = await import("../src/server/power/monitor.ts");
  const queries: { sql: string; args?: unknown[] }[] = [];
  const db = {
    async query(sql: string, args?: unknown[]) {
      queries.push({ sql, args });
      if (sql.startsWith("SELECT status, observed_at")) return { rows: [{ status: "online", observedAt: at(11) }] };
      if (sql.startsWith("SELECT soc_pct")) return { rows: [{ socPct: 42, measuredAt: at(12) }] };
      return { rows: [] };
    },
  } as unknown as import("pg").Client;
  await savePowerState(db, { status: "online", lastKnownStatus: "online", checkedAt: at(11) }, "offline", at(12), true);
  assert.equal(queries[0].sql, "BEGIN");
  assert.equal(queries.at(-1)?.sql, "COMMIT");
  const inserted = queries.find((query) => query.sql.startsWith("INSERT INTO telegram_outbox"));
  const message = (inserted?.args?.[0] as string[])[0];
  assert.match(message, /Зі світлом: щонайменше 1 год/);
  assert.match(message, /чергу не налаштовано/);

  queries.length = 0;
  await savePowerState(db, { status: "unknown", lastKnownStatus: "online", checkedAt: at(11) }, "offline", at(12), true);
  const uncertain = queries.find((query) => query.sql.startsWith("INSERT INTO telegram_outbox"));
  assert.match((uncertain?.args?.[0] as string[])[0], /Зі світлом: тривалість невідома/);
  assert.ok(!queries.some((query) => query.sql.startsWith("SELECT status, observed_at")));

  queries.length = 0;
  await savePowerState(db, { status: "offline", lastKnownStatus: "offline", checkedAt: at(11) }, "online", at(12), true, at(12), 30_000, true, undefined, { id: "station-a", staleAfterMs: 5_000 });
  const withCharge = queries.find((query) => query.sql.startsWith("INSERT INTO telegram_outbox"));
  assert.match((withCharge?.args?.[0] as string[])[0], /Заряд станції: \*42%\*/);
  assert.deepEqual(queries.find((query) => query.sql.startsWith("SELECT soc_pct"))?.args, ["station-a", at(12)]);
});


test("battery lookup keeps zero and rejects missing, stale or unknown charge", async () => {
  const { findChargeAt } = await import("../src/server/stations/repository.ts");
  let rows: { socPct: number | null; measuredAt: Date }[] = [];
  let params: unknown[] = [];
  const db = { async query(_sql: string, args: unknown[]) { params = args; return { rows }; } } as unknown as import("pg").Client;
  assert.equal(await findChargeAt(db, "station-a", at(12), 5_000), null);
  rows = [{ socPct: 0, measuredAt: new Date(at(12).getTime() - 4_999) }];
  assert.equal(await findChargeAt(db, "station-a", at(12), 5_000), 0);
  assert.deepEqual(params, ["station-a", at(12)]);
  rows = [{ socPct: 30, measuredAt: new Date(at(12).getTime() - 5_000) }];
  assert.equal(await findChargeAt(db, "station-a", at(12), 5_000), null);
  rows = [{ socPct: null, measuredAt: at(12) }];
  assert.equal(await findChargeAt(db, "station-a", at(12), 5_000), null);
});
