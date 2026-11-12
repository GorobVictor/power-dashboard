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

test("reports missing data and safe WebDriver errors", async () => {
  const { DtekBrowser } = await import("../src/server/outages/dtek.ts");
  const originalFetch = globalThis.fetch;
  let step = 0;
  try {
    globalThis.fetch = async () => {
      const values = [{ sessionId: "session" }, null, { fact: null, challenge: false }];
      return Response.json({ value: values[step++] });
    };
    await assert.rejects(new DtekBrowser("http://selenium").poll(), /does not contain DisconSchedule.fact/);
    globalThis.fetch = async () => Response.json({ value: { error: "session not created", message: "sensitive session details" } }, { status: 500 });
    await assert.rejects(new DtekBrowser("http://selenium").poll(), (error: Error) => {
      assert.equal(error.message, "WebDriver: session not created");
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("identifies the failing browser command without exposing its response", async () => {
  const { DtekBrowser } = await import("../src/server/outages/dtek.ts");
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => ++calls === 1
      ? Response.json({ value: { sessionId: "private-session" } })
      : Response.json({ value: { error: "timeout", message: "private details" } }, { status: 500 });
    const browser = new DtekBrowser("http://selenium");
    await assert.rejects(browser.poll(), /WebDriver: timeout/);
    assert.equal(browser.stage, "browser.navigate");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
