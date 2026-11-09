import assert from "node:assert/strict";
import test from "node:test";
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
