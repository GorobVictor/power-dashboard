import assert from "node:assert/strict";
import test from "node:test";
import { powerIntervals } from "../src/lib/power-history.ts";

const event = (time: number, status: "online" | "offline" | "unknown") => ({ status, observedAt: new Date(time).toISOString() });

test("power intervals align events with the requested range and exclude the future", () => {
  assert.deepEqual(powerIntervals([event(5_000, "online"), event(12_000, "offline"), event(14_000, "online")], 10_000, 20_000, 16_000), [
    { status: "online", start: 10_000, end: 12_000 },
    { status: "offline", start: 12_000, end: 14_000 },
    { status: "online", start: 14_000, end: 16_000 },
  ]);
});

test("missing data and expired monitoring become unknown", () => {
  assert.deepEqual(powerIntervals([event(12_000, "online")], 10_000, 20_000, 18_000, new Date(13_000).toISOString(), 2_000), [
    { status: "unknown", start: 10_000, end: 12_000 },
    { status: "online", start: 12_000, end: 15_000 },
    { status: "unknown", start: 15_000, end: 18_000 },
  ]);
  assert.deepEqual(powerIntervals([], 10_000, 20_000, 9_000), []);
});
