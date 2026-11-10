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
    const migrate = () => runner({
      dbClient: db, dir: "migrations", direction: "up",
      schema, createSchema: true, migrationsTable: "pgmigrations",
    });
    assert.equal((await migrate()).length, 4);
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
    assert.equal(await findLatest(db, "missing"), null);
    assert.equal((await findLatest(db, second.id))?.measurement, null);

    const metrics = decodeState(Buffer.alloc(139));
    const old = { ...metrics, socPct: 18, measuredAt: new Date("2026-01-01T00:00:00Z") };
    const latest = { ...metrics, socPct: 0, measuredAt: new Date("2026-01-01T00:00:01Z") };
    const otherLatest = { ...latest, socPct: 87, batteryPowerW: null, totalEnergyInWh: 42_949_672_950 };
    const updates: { stationId: string; measurement: { socPct: number | null } }[] = [];
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
    assert.deepEqual(updates.map(({ stationId, measurement }) => [stationId, measurement.socPct]), [
      [first.id, 0], [first.id, 18], [second.id, 87],
    ]);
    assert.equal((await migrate()).length, 0);
    await registerStation(db, first);
    await assert.rejects(registerStation(db, { ...first, deviceId: "different" }), /different device/);
    assert.deepEqual((await findLatest(db, first.id))?.measurement, latest);
    assert.deepEqual((await findLatest(db, second.id))?.measurement, otherLatest);

    await t.test("history preserves gaps, signed values and the last sample per station and bucket", async () => {
      const earlier = { ...old, measuredAt: new Date(old.measuredAt.getTime() - 45_000), socPct: null, gridPowerW: -100 };
      await saveMeasurement(db, first.id, earlier);
      await saveMeasurement(db, first.id, { ...old, measuredAt: new Date(old.measuredAt.getTime() - 7_200_000) });
      const end = latest.measuredAt.getTime();
      const firstHistory = await findTelemetryHistory(db, first.id, "1h", end);
      const secondHistory = await findTelemetryHistory(db, second.id, "1h", end);
      assert.deepEqual(firstHistory.samples.map(({ time, socPct, gridPowerW }) => [time, socPct, gridPowerW]), [
        [earlier.measuredAt.getTime(), null, -100],
        [end, 0, 0],
      ]);
      assert.deepEqual(secondHistory.samples.map(({ socPct, batteryPowerW }) => [socPct, batteryPowerW]), [[87, null]]);
      assert.equal((await findTelemetryHistory(db, first.id, "1h", old.measuredAt.getTime())).samples.at(-1)?.socPct, 18);
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
      const { rows } = await db.query<{ message: string }>("SELECT message FROM telegram_outbox ORDER BY id");
      return rows.map(({ message }) => message);
    };

    await t.test("queues battery transitions once and retains known readings through gaps", async () => {
      assert.equal(await lockStation(db, first.id), true);
      let battery = await readBatteryBaseline(db, first.id);
      const at = (seconds: number) => new Date(latest.measuredAt.getTime() + seconds * 1_000);
      const save = async (seconds: number, batteryPowerW: number | null, socPct: number | null) => {
        battery = await saveBatteryReading(
          db, first, { ...metrics, measuredAt: at(seconds), batteryPowerW, socPct }, battery, { lowBatteryPct: 20 },
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
      await save(6, 0, 20);
      await save(7, 0, 19);
      await save(8, 0, 100);
      await save(9, -100, 99);
      await save(10, -100, 98);
      await save(11, 200, 98);
      await save(12, -100, 98);
      await save(13, 200, 95);
      await save(14, 200, 94);
      await save(15, 0, 94);
      await save(16, 200, 94);
      await save(17, -100, null);
      assert.deepEqual(await telegramMessages(), [
        "First · Акумулятор почав заряджатися. Заряд 30%.",
        "First · Акумулятор почав розряджатися. Заряд 19%.",
        "First · Заряд акумулятора впав до 19% (поріг 20%).",
        "First · Заряд акумулятора впав до 19% (поріг 20%).",
        "First · Акумулятор почав розряджатися. Заряд 98%.",
        "First · Акумулятор почав заряджатися. Заряд 94%.",
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
        ...waiting, content: { ...waiting.content, status: "ScheduleApplies", hours: Array(24).fill(1) },
      };
      const otherQueue = { ...published, queue: "4.2" };
      const updated: Schedule = {
        ...published, content: { ...published.content, status: "NoShutdowns", hours: Array(24).fill(0) },
      };
      const at = (minute: number) => new Date(Date.UTC(2026, 10, 13, 0, minute));
      await saveOutagePollWithTelegram(db, [waiting, otherQueue], at(0), waiting.queue);
      assert.deepEqual(await telegramMessages(), []);
      await saveOutagePollWithTelegram(db, [otherQueue, published], at(1), waiting.queue);
      await saveOutagePollWithTelegram(db, [published, otherQueue], at(2), waiting.queue);
      const otherChanged = { ...updated, queue: otherQueue.queue };
      await saveOutagePollWithTelegram(db, [published, otherChanged], at(3), waiting.queue);
      await saveOutagePollWithTelegram(db, [updated, otherChanged], at(4), waiting.queue);
      assert.deepEqual(await telegramMessages(), [
        "ДТЕК · Київська область · 13.11.2026\nЗ’явився графік для черги 4.1.",
        "ДТЕК · Київська область · 13.11.2026\nОновився графік для черги 4.1.",
      ]);
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
      const options = { lowBatteryPct: 20, outageQueue: queue };
      const battery = await readBatteryBaseline(db, first.id);
      const charging = await saveBatteryReading(
        db, first, { ...metrics, measuredAt: at(29), batteryPowerW: 100, socPct: 30 }, battery, options,
      );
      await saveBatteryReading(
        db, first, { ...metrics, measuredAt: at(30), batteryPowerW: -100, socPct: 29 }, charging, options,
      );
      assert.deepEqual(await telegramMessages(), [
        "First · Акумулятор почав заряджатися. Заряд 30%.\nЗа графіком черги 4.1 зараз відключення.",
        "First · Акумулятор почав розряджатися. Заряд 29%.\nЗа графіком черги 4.1 зараз має бути світло.",
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
