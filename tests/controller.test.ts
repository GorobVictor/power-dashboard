import assert from "node:assert/strict";
import test from "node:test";
import { powerController } from "../src/server/power/controller.ts";
import { powerStatus } from "../src/server/power/service.ts";
import { latestController } from "../src/server/stations/controller.ts";

test("authenticates before reading telemetry and returns distinct station statuses", async (t) => {
  t.mock.method(console, "error", () => {});
  process.env.API_USERNAME = "homarr";
  process.env.API_PASSWORD = "secret:фраза";
  const url = "http://localhost/api/v1/stations/station/latest";
  const auth = (value: string) => new Request(url, {
    headers: { Authorization: `Basic ${Buffer.from(value).toString("base64")}` },
  });
  const authorized = auth("homarr:secret:фраза");
  const empty = { station: { id: "station", name: "Test", model: "VNSE3-0" }, measurement: null, stale: null };
  let reads = 0;
  const readEmpty = async () => { reads++; return empty; };

  for (const request of [new Request(url), auth("homarr:bad"), auth("other:secret:фраза")]) {
    const response = await latestController(request, "station", readEmpty);
    assert.equal(response.status, 401);
    assert.match(response.headers.get("WWW-Authenticate") ?? "", /^Basic /);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
  assert.equal(reads, 0);

  const noData = await latestController(authorized, "station", readEmpty);
  assert.equal(noData.status, 200);
  assert.deepEqual(await noData.json(), empty);
  assert.equal((await latestController(authorized, "missing", async () => null)).status, 404);
  assert.equal((await latestController(authorized, "station", async () => {
    throw new Error("Database unavailable");
  })).status, 503);
});


test("power status endpoint requires auth and marks stale observations unknown", async () => {
  process.env.API_USERNAME = "homarr";
  process.env.API_PASSWORD = "test-password";
  const url = "http://localhost/api/v1/power/latest";
  const auth = { Authorization: `Basic ${Buffer.from("homarr:test-password").toString("base64")}` };
  const request = new Request(url, { headers: auth });
  const state = { status: "online" as const, checkedAt: "2026-11-17T00:00:00.000Z", staleAfterMs: 5_000, lastOnlineAt: null, lastOfflineAt: null };
  const time = Date.parse(state.checkedAt);
  assert.equal(powerStatus(state, time + 4_999)?.status, "online");
  assert.equal(powerStatus(state, time + 5_000)?.status, "unknown");
  assert.equal(powerStatus(state, time - 1)?.status, "unknown");
  assert.equal(powerStatus(null, time), null);
  let calls = 0;
  const read = async () => { calls++; return powerStatus(state, time); };
  assert.equal((await powerController(new Request(url), read)).status, 401);
  assert.equal(calls, 0);
  const response = await powerController(request, read);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal((await response.json()).power.status, "online");
  assert.deepEqual(await (await powerController(request, async () => null)).json(), { power: null });
  assert.equal((await powerController(request, async () => { throw new Error("db"); })).status, 503);
});
