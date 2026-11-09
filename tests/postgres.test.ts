import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { runner } from "node-pg-migrate";
import { Client } from "pg";
import { decodeState } from "../src/server/marstek/protocol.ts";
import { findLatest, lockStation, registerStation, saveMeasurement } from "../src/server/stations/repository.ts";

const connectionString = process.env.TEST_DATABASE_URL;

test("PostgreSQL migrations, station isolation, and session locks", { skip: !connectionString }, async () => {
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
    assert.equal((await migrate()).length, 1);
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
    await saveMeasurement(db, first.id, latest);
    await saveMeasurement(db, first.id, old);
    await saveMeasurement(db, first.id, { ...latest, socPct: 10 });
    await saveMeasurement(db, second.id, otherLatest);
    assert.equal((await migrate()).length, 0);
    await registerStation(db, first);
    await assert.rejects(registerStation(db, { ...first, deviceId: "different" }), /different device/);
    assert.deepEqual((await findLatest(db, first.id))?.measurement, latest);
    assert.deepEqual((await findLatest(db, second.id))?.measurement, otherLatest);

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
