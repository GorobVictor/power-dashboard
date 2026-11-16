import assert from "node:assert/strict";
import test from "node:test";
import { nextPollAt } from "../src/server/power/monitor.ts";

test("polling is scheduled every second without waiting again after a slow probe", () => {
  assert.equal(nextPollAt(10_000, 10_100, 1_000), 11_000);
  assert.equal(nextPollAt(10_000, 11_100, 1_000), 11_100);
  assert.equal(nextPollAt(11_100, 11_200, 1_000), 12_100);
});
