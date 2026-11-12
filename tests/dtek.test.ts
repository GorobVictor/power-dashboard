import { test } from "node:test";
import { strict as assert } from "node:assert";
import { parseDtekFact } from "../src/server/outages/dtek.ts";

test("DTEK fact maps Kyiv date, groups and half-hour outages", () => {
  const hours = Object.fromEntries(Array.from({ length: 24 }, (_, i) => [String(i + 1), ["yes", "no", "first", "second"][i % 4]]));
  const schedules = parseDtekFact({ data: { "1794434400": { "GPV3.2": hours, "GPV4.1": hours } } });
  assert.deepEqual(schedules.map(({ queue, date }) => [queue, date]), [["3.2", "2026-11-12"], ["4.1", "2026-11-12"]]);
  assert.deepEqual(schedules[0].content.hours.slice(0, 4), [0, 1, 2, 3]);
  assert.throws(() => parseDtekFact({ data: { "1794434400": { "GPV3.2": { ...hours, 4: "unknown" } } } }));
  assert.throws(() => parseDtekFact({ data: {} }));
});

test("selects alerts.energy by default and DTEK only when configured", async () => {
  const { outageSourceId } = await import("../src/server/outages/repository.ts");
  const previous = process.env.OUTAGE_SOURCE;
  try {
    delete process.env.OUTAGE_SOURCE;
    assert.match(outageSourceId(), /^alerts\.energy:/);
    process.env.OUTAGE_SOURCE = "dtek";
    assert.match(outageSourceId(), /^dtek:/);
    process.env.OUTAGE_SOURCE = "invalid";
    assert.throws(() => outageSourceId(), /OUTAGE_SOURCE/);
  } finally {
    if (previous === undefined) delete process.env.OUTAGE_SOURCE;
    else process.env.OUTAGE_SOURCE = previous;
  }
});
