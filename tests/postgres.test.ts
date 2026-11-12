import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { runner } from "node-pg-migrate";
import { Client } from "pg";
import { decodeState } from "../src/server/marstek/protocol.ts";
import { findCurrentSchedules, findScheduleHistory, lockOutageSource, saveOutagePoll } from "../src/server/outages/repository.ts";
import type { Schedule } from "../src/server/outages/schedules.ts";
import { findLatest, findTelemetryHistory, lockStation, registerStation, saveMeasurement } from "../src/server/stations/repository.ts";
import { readBatteryBaseline, saveBatteryReading } from "../src/server/telegram/battery.ts";
import { describeOutageAt, saveOutagePollWithTelegram } from "../src/server/telegram/outages.ts";

const connectionString = process.env.TEST_DATABASE_URL;

test("PostgreSQL migrations, station isolation, and outage history", { skip: !connectionString }, async (t) => {
  const schema = `power_test_${randomBytes(8).toString("hex")}`;
  const db = new Client({ connectionString });
  const other = new Client({ connectionString });
  await db.connect();
  try {
    await other.connect();
    const migrate = (count?: number) => runner({
      dbClient: db, dir: "migrations", direction: "up",
      schema, createSchema: true, migrationsTable: "pgmigrations", count,
    });
    assert.equal((await migrate(4)).length, 4);
    await db.query("INSERT INTO telegram_outbox (message) VALUES ('Legacy message.')");
    assert.equal((await migrate(1)).length, 1);
    assert.deepEqual((await db.query("DELETE FROM telegram_outbox RETURNING message, parse_mode")).rows, [
      { message: "Legacy message.", parse_mode: null },
    ]);
    const first = {
      id: "793319323732595650000001", name: "First", model: "VNSE3-0",
      deviceId: "first-device", bleMac: "02:00:00:00:00:01",
    };
    const second = {
      ...first, id: "793319323732595650000002", name: "Second",
      deviceId: "second-device", bleMac: "02:00:00:00:00:02",
    };
    await registerStation(db, first);
    await registerStation(db, second);
    await db.query("INSERT INTO measurements (station_id, measured_at, work_mode) VALUES ($1, '2025-12-31T00:00:00Z', 1)", [first.id]);
    assert.equal((await migrate()).length, 1);
    assert.equal((await findLatest(db, first.id))?.measurement?.upsEnabled, null);
    assert.equal(await findLatest(db, "missing"), null);
    assert.equal((await findLatest(db, second.id))?.measurement, null);

    const metrics = { ...decodeState(Buffer.alloc(139)), upsEnabled: null };
    const old = { ...metrics, socPct: 18, measuredAt: new Date("2026-01-01T00:00:00Z") };
    const latest = { ...metrics, workMode: 1, upsEnabled: true, socPct: 0, measuredAt: new Date("2026-01-01T00:00:01Z") };
    const otherLatest = { ...latest, upsEnabled: false, socPct: 87, batteryPowerW: null, totalEnergyInWh: 42_949_672_950 };
    const updates: { stationId: string; measurement: { socPct: number | null; upsEnabled: boolean | null } }[] = [];
    other.on("notification", ({ payload }) => {
      if (payload) updates.push(JSON.parse(payload));
    });
    await other.query("LISTEN power_dashboard_updates");
    await db.query("BEGIN");
    await saveMeasurement(db, first.id, latest);
    await other.query("SELECT 1");
    assert.equal(updates.length, 0);
    await db.query("COMMIT");
    await saveMeasurement(db, first.id, old);
    await saveMeasurement(db, first.id, { ...latest, socPct: 10 });
    await saveMeasurement(db, second.id, otherLatest);
    await db.query("BEGIN");
    await saveMeasurement(db, first.id, { ...latest, measuredAt: new Date("2026-01-01T00:00:02Z") });
    await db.query("ROLLBACK");
    await other.query("SELECT 1");
    await other.query("UNLISTEN power_dashboard_updates");
    assert.deepEqual(updates.map(({ stationId, measurement }) => [stationId, measurement.socPct, measurement.upsEnabled]), [
      [first.id, 0, true], [first.id, 18, null], [second.id, 87, false],
    ]);
    assert.equal((await migrate()).length, 0);
    await registerStation(db, first);
    await assert.rejects(registerStation(db, { ...first, deviceId: "different" }), /different device/);
    assert.deepEqual((await findLatest(db, first.id))?.measurement, latest);
    assert.deepEqual((await findLatest(db, second.id))?.measurement, otherLatest);

    await t.test("history preserves gaps, signed values and the last sample per station and bucket", async () => {
      const earlier = { ...old, measuredAt: new Date(old.measuredAt.getTime() - 45_000), socPct: null, gridPowerW: -100 };
      await saveMeasurement(db, first.id, earlier);
      const midnight = { ...old, measuredAt: new Date("2025-12-31T22:00:00Z") };
      await saveMeasurement(db, first.id, midnight);
      const end = latest.measuredAt.getTime();
      const firstHistory = await findTelemetryHistory(db, first.id, "1h", end);
      const secondHistory = await findTelemetryHistory(db, second.id, "1h", end);
      assert.deepEqual(firstHistory.samples.map(({ time, socPct, gridPowerW }) => [time, socPct, gridPowerW]), [
        [earlier.measuredAt.getTime(), null, -100],
        [end, 0, 0],
      ]);
      assert.deepEqual(secondHistory.samples.map(({ socPct, batteryPowerW }) => [socPct, batteryPowerW]), [[87, null]]);
      assert.equal((await findTelemetryHistory(db, first.id, "1h", old.measuredAt.getTime())).samples.at(-1)?.socPct, 18);

      const previousDay = { from: "2025-12-31", to: "2025-12-31" };
      const newYear = { from: "2026-01-01", to: "2026-01-01" };
      const previous = await findTelemetryHistory(db, first.id, previousDay);
      const current = await findTelemetryHistory(db, first.id, newYear);
      assert.ok(previous.samples.length > 0);
      assert.ok(previous.samples.every(({ time }) => time < midnight.measuredAt.getTime()));
      assert.deepEqual(current.samples.map(({ time }) => time), [midnight.measuredAt.getTime(), earlier.measuredAt.getTime(), end]);
      assert.deepEqual((await findTelemetryHistory(db, second.id, newYear)).samples.map(({ socPct }) => socPct), [87]);
    });

    await t.test("records outage transitions atomically and keeps only the last poll current", async () => {
      const date = "2026-11-11";
      const tomorrow = "2026-11-12";
      const firstSchedule: Schedule = {
        queue: "4.1", date,
        content: { status: "NoShutdowns", hours: Array(24).fill(0), possible: [], publishedSchedule: null },
      };
      const changed: Schedule = {
        ...firstSchedule,
        content: { ...firstSchedule.content, status: "ScheduleApplies", hours: Array(24).fill(1) },
      };
      const nextDay = { ...firstSchedule, date: tomorrow };
      const otherQueue = { ...firstSchedule, queue: "5.2" };
      const at = (minute: number) => new Date(Date.UTC(2026, 10, 11, 0, minute));

      assert.deepEqual(await findCurrentSchedules(db, date, null), { schedules: [], lastSuccessfulPollAt: null });
      assert.equal(await lockOutageSource(db), true);
      assert.equal(await lockOutageSource(other), false);

      await saveOutagePoll(db, [firstSchedule, otherQueue, nextDay], at(0));
      await saveOutagePoll(db, [firstSchedule, otherQueue, nextDay], at(1));
      await saveOutagePoll(db, [changed, otherQueue, nextDay], at(2));
      await saveOutagePoll(db, [firstSchedule, nextDay], at(3));
      const history = await findScheduleHistory(db, date, firstSchedule.queue);
      assert.deepEqual(history.map(({ status }) => status), ["NoShutdowns", "ScheduleApplies", "NoShutdowns"]);
      assert.deepEqual(history.map(({ observedAt }) => observedAt), [at(0), at(2), at(3)]);
      assert.equal((await findScheduleHistory(db, date, otherQueue.queue)).length, 1);
      assert.equal((await findScheduleHistory(db, tomorrow, firstSchedule.queue)).length, 1);
      assert.deepEqual(await findCurrentSchedules(db, date, otherQueue.queue), { schedules: [], lastSuccessfulPollAt: at(3) });
      assert.deepEqual((await findCurrentSchedules(db, tomorrow, null)).schedules.map(({ date }) => date), [tomorrow]);

      await assert.rejects(saveOutagePoll(db, [changed, { ...nextDay, date: "invalid" }], at(4)));
      assert.equal((await findCurrentSchedules(db, date, null)).lastSuccessfulPollAt?.getTime(), at(3).getTime());
      assert.equal((await findScheduleHistory(db, date, firstSchedule.queue)).length, 3);

      await saveOutagePoll(db, [], at(5));
      assert.deepEqual(await findCurrentSchedules(db, date, null), { schedules: [], lastSuccessfulPollAt: at(5) });
      await db.query("SELECT pg_advisory_unlock_all()");
      assert.equal(await lockOutageSource(other), true);
      await other.query(`SET search_path TO "${schema}"`);
      await saveOutagePoll(other, [firstSchedule], at(6));
      assert.equal((await findScheduleHistory(db, date, firstSchedule.queue)).length, 3);
      assert.equal((await findCurrentSchedules(db, date, null)).lastSuccessfulPollAt?.getTime(), at(6).getTime());
    });

    const telegramMessages = async () => {
      const { rows } = await db.query<{ message: string; parse_mode: string }>(
        "SELECT message, parse_mode FROM telegram_outbox ORDER BY id",
      );
      return rows.map(({ message, parse_mode }) => {
        assert.equal(parse_mode, "MarkdownV2");
        return message;
      });
    };

    await t.test("queues battery transitions once and retains known readings through gaps", async () => {
      assert.equal(await lockStation(db, first.id), true);
      let battery = await readBatteryBaseline(db, first.id);
      const at = (seconds: number) => new Date(latest.measuredAt.getTime() + seconds * 1_000);
      const save = async (seconds: number, batteryPowerW: number | null, socPct: number | null) => {
        battery = await saveBatteryReading(
          db, first, { ...metrics, measuredAt: at(seconds), batteryPowerW, socPct }, battery, {},
        );
      };
      await save(1, 200, 30);
      await save(1, -100, 10); // A duplicate timestamp leaves the state and outbox unchanged.
      await save(2, null, null);
      battery = await readBatteryBaseline(db, first.id);
      assert.deepEqual(battery, { batteryPowerW: 200, socPct: 30 });
      await save(3, 200, 20);
      await save(4, -100, 19);
      await save(5, -100, 18);
      await save(6, 0, 21);
      await save(7, 0, 19);
      await save(8, 0, 100);
      await save(9, -100, 99);
      await save(10, 200, 99);
      await save(11, -100, 100);
      await save(12, -100, 99);
      battery = await readBatteryBaseline(db, first.id);
      await save(13, -100, 98);
      await save(14, -100, 97);
      await save(15, 200, 97);
      await save(16, -100, 97);
      await save(17, 200, 99);
      await save(18, 200, 94);
      await save(19, 0, 94);
      await save(20, 200, 94);
      await save(21, -100, null);
      assert.deepEqual(await telegramMessages(), [
        "⚡ *Акумулятор заряджається*\nFirst\n\nЗаряд: *30%*",
        "⚠️ *Небезпечний рівень заряду · 20%*\nFirst\n\nЗаряд: *20%*",
        "🔋 *Акумулятор розряджається*\nFirst\n\nЗаряд: *19%*",
        "⚠️ *Небезпечний рівень заряду · 20%*\nFirst\n\nЗаряд: *19%*",
        "🔋 *Акумулятор розрядився нижче 99%*\nFirst\n\nЗаряд: *98%*",
        "⚡ *Акумулятор заряджається*\nFirst\n\nЗаряд: *97%*",
        "🔋 *Акумулятор розряджається*\nFirst\n\nЗаряд: *97%*",
        "⚡ *Акумулятор заряджається*\nFirst\n\nЗаряд: *94%*",
      ]);
      assert.deepEqual(await readBatteryBaseline(db, second.id), { batteryPowerW: null, socPct: 87 });
      await db.query("DELETE FROM telegram_outbox");
    });

    await t.test("queues DTEK publications and updates only for the configured queue", async () => {
      await other.query("SELECT pg_advisory_unlock_all()");
      assert.equal(await lockOutageSource(db), true);
      const waiting: Schedule = {
        queue: "4.1", date: "2026-11-13",
        content: { status: "WaitingForSchedule", hours: [], possible: [], publishedSchedule: null },
      };
      const published: Schedule = {
        ...waiting, content: {
          ...waiting.content, status: "ScheduleApplies",
          hours: [1, 2, 3, ...Array(21).fill(0)], possible: [0, 0, 0, 1, ...Array(20).fill(0)],
        },
      };
      const otherQueue = { ...published, queue: "4.2" };
      const updated: Schedule = {
        ...published, content: { ...waiting.content, status: "NoShutdowns" },
      };
      const at = (minute: number) => new Date(Date.UTC(2026, 10, 13, 0, minute));
      await saveOutagePollWithTelegram(db, [waiting, otherQueue], at(0), waiting.queue);
      assert.deepEqual(await telegramMessages(), []);
      await saveOutagePollWithTelegram(db, [otherQueue, published], at(1), waiting.queue);
      await saveOutagePollWithTelegram(db, [published, otherQueue], at(2), waiting.queue);
      const otherChanged = { ...updated, queue: otherQueue.queue };
      await saveOutagePollWithTelegram(db, [published, otherChanged], at(3), waiting.queue);
      await saveOutagePollWithTelegram(db, [updated, otherChanged], at(4), waiting.queue);
      const shorter: Schedule = {
        ...published, content: { ...published.content, hours: [2, ...Array(23).fill(0)] },
      };
      const shifted: Schedule = {
        ...shorter, content: { ...shorter.content, hours: [3, ...Array(23).fill(0)] },
      };
      const possibleChanged: Schedule = {
        ...shifted, content: { ...shifted.content, possible: [...Array(23).fill(0), 3] },
      };
      const emergency: Schedule = {
        ...possibleChanged, content: { ...possibleChanged.content, status: "EmergencyShutdowns", hours: Array(24).fill(9) },
      };
      await saveOutagePollWithTelegram(db, [shorter, otherChanged], at(5), waiting.queue);
      await saveOutagePollWithTelegram(db, [shifted, otherChanged], at(6), waiting.queue);
      await saveOutagePollWithTelegram(db, [possibleChanged, otherChanged], at(7), waiting.queue);
      await saveOutagePollWithTelegram(db, [emergency, otherChanged], at(8), waiting.queue);
      const messages = await telegramMessages();
      assert.equal(messages.length, 6);
      assert.equal(messages[0], [
        "📅 *З’явився графік ДТЕК*", "Черга *4\\.1* · 13\\.11\\.2026 · Київська область", "",
        "💡 Зі світлом: *22 год*", "🌑 Без світла: *2 год*",
      ].join("\n"));
      assert.match(messages[1], /^🟢 \*Графік покращився · світла на 2 год більше\*[\s\S]*24 год/);
      assert.match(messages[1], /Змінилися планові відключення\*\nБуло: 00:00–01:30, 02:30–03:00\nСтало: —/);
      assert.match(messages[2], /^🔴 \*Графік погіршився · світла на 30 хв менше\*[\s\S]*23 год 30 хв/);
      assert.match(messages[2], /Змінилися планові відключення\*\nБуло: —\nСтало: 00:00–00:30/);
      assert.match(messages[3], /^🔄 \*Відключення перенесли · загальна тривалість не змінилася\*/);
      assert.match(messages[3], /Змінилися планові відключення\*\nБуло: 00:00–00:30\nСтало: 00:30–01:00/);
      assert.doesNotMatch(messages[3], /Змінилися можливі відключення/);
      assert.match(messages[4], /Змінилися можливі відключення\*\nБуло: 03:00–04:00\nСтало: 23:30–24:00/);
      assert.doesNotMatch(messages[4], /Змінилися планові відключення/);
      assert.match(messages[5], /^⚠️ \*Графік оновився · порівняння недоступне\*[\s\S]*аварійні обмеження[\s\S]*Тривалість відключень за добу поки невідома/);
      assert.doesNotMatch(messages[5], /Змінилися планові відключення/);
      assert.equal((await findScheduleHistory(db, waiting.date, otherQueue.queue)).length, 2);
      await db.query("DELETE FROM telegram_outbox");
    });

    await t.test("adds the configured queue's schedule at the measurement's Kyiv time", async () => {
      const queue = "4.1";
      const schedule: Schedule = {
        queue, date: "2026-11-14",
        content: {
          status: "ScheduleApplies", hours: [2, ...Array(23).fill(0)], possible: [], publishedSchedule: null,
        },
      };
      const at = (minute: number) => new Date(Date.UTC(2026, 10, 13, 22, minute));
      await saveOutagePoll(db, [schedule], at(28));
      const options = { outageQueue: queue };
      const battery = await readBatteryBaseline(db, first.id);
      const charging = await saveBatteryReading(
        db, first, { ...metrics, measuredAt: at(29), batteryPowerW: 100, socPct: 30 }, battery, options,
      );
      const discharging = await saveBatteryReading(
        db, first, { ...metrics, measuredAt: at(30), batteryPowerW: -100, socPct: 29 }, charging, options,
      );
      await saveBatteryReading(
        db, first, { ...metrics, measuredAt: new Date(at(30).getTime() + 1000), batteryPowerW: -100, socPct: 19 }, discharging, options,
      );
      assert.deepEqual(await telegramMessages(), [
        "⚡ *Акумулятор заряджається*\nFirst\n\nЗаряд: *30%*\n\n📅 За графіком черги 4\\.1 зараз відключення\\.",
        "⚠️ *Небезпечний рівень заряду · 30%*\nFirst\n\nЗаряд: *30%*\n\n📅 За графіком черги 4\\.1 зараз відключення\\.",
        "🔋 *Акумулятор розряджається*\nFirst\n\nЗаряд: *29%*\n\n📅 За графіком черги 4\\.1 зараз має бути світло\\.",
        "⚠️ *Небезпечний рівень заряду · 20%*\nFirst\n\nЗаряд: *19%*\n\n📅 За графіком черги 4\\.1 зараз має бути світло\\.",
      ]);
      assert.match(await describeOutageAt(db, queue, at(31)), /застарів/);
      assert.match(await describeOutageAt(db, "4.2", at(30)), /недоступний/);

      const possible: Schedule = { ...schedule, content: { ...schedule.content, possible: [3, ...Array(23).fill(0)] } };
      await saveOutagePoll(db, [possible], at(32));
      assert.match(await describeOutageAt(db, queue, at(32)), /можливе відключення/);
      const emergency: Schedule = { ...schedule, content: { ...schedule.content, status: "EmergencyShutdowns" } };
      await saveOutagePoll(db, [emergency], at(33));
      assert.match(await describeOutageAt(db, queue, at(33)), /аварійні обмеження/);
    });

    const lockId = `${schema}:station`;
    assert.equal(await lockStation(other, lockId), true);
    assert.equal(await lockStation(db, lockId), false);
    await other.end();
    assert.equal(await lockStation(db, lockId), true);
  } finally {
    await other.end();
    try {
      await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await db.end();
    }
  }
});
