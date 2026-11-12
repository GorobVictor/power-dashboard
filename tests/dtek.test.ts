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

test("reads schedule from a global lexical binding or inline HTML", async () => {
  const { runInNewContext } = await import("node:vm");
  const { DtekBrowser } = await import("../src/server/outages/dtek.ts");
  const originalFetch = globalThis.fetch;
  const hours = Object.fromEntries(Array.from({ length: 24 }, (_, i) => [String(i + 1), "yes"]));
  const fact = { data: { "1794434400": { "GPV3.2": hours } } };
  try {
    for (const lexical of [true, false]) {
      globalThis.fetch = async (input, init) => {
        const url = String(input);
        if (url.endsWith("/session")) return Response.json({ value: { sessionId: "session" } });
        if (url.endsWith("/url")) return Response.json({ value: null });
        const { script } = JSON.parse(String(init?.body));
        const context = { window: {}, document: { scripts: [{ textContent: `DisconSchedule.fact = ${JSON.stringify(fact)};` }], querySelector: () => null, body: { innerText: "" } } };
        const prefix = lexical ? `const DisconSchedule = { fact: ${JSON.stringify(fact)} };` : "";
        return Response.json({ value: runInNewContext(`${prefix} (function(){ ${script} })()`, context) });
      };
      const result = await new DtekBrowser("http://selenium").poll();
      assert.equal(result.challenge, false);
      if (!result.challenge) assert.equal(result.schedules[0].queue, "3.2");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("closes the owned WebDriver session once after polling", async () => {
  const { DtekBrowser } = await import("../src/server/outages/dtek.ts");
  const originalFetch = globalThis.fetch;
  const calls: { url: string; method: string }[] = [];
  try {
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET" });
      if (init?.method === "DELETE") return Response.json({ value: null });
      if (url.endsWith("/session")) return Response.json({ value: { sessionId: "owned-session" } });
      if (url.endsWith("/url")) return Response.json({ value: null });
      return Response.json({ value: { fact: null, challenge: true } });
    };
    const browser = new DtekBrowser("http://selenium");
    await browser.poll();
    await browser.close();
    await browser.close();
    assert.deepEqual(calls.filter(({ method }) => method === "DELETE"), [
      { url: "http://selenium/session/owned-session", method: "DELETE" },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("interrupts a pending WebDriver command when the worker shuts down", async () => {
  const { DtekBrowser } = await import("../src/server/outages/dtek.ts");
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });
    const shutdown = new AbortController();
    const pending = new DtekBrowser("http://selenium").poll(shutdown.signal);
    shutdown.abort();
    await assert.rejects(pending);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
