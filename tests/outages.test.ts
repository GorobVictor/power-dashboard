import assert from "node:assert/strict";
import test from "node:test";
import { AlertsHttpError, fetchSchedules, parseSiteToken } from "../src/server/outages/client.ts";
import { telemetryWindow } from "../src/lib/telemetry-history.ts";
import { currentOutages, outageHistory, outageOverview } from "../src/server/outages/controller.ts";
import { getOutageOverview } from "../src/server/outages/overview.ts";
import { operator, parseSchedules } from "../src/server/outages/schedules.ts";
import { outageSource } from "../src/server/outages/service.ts";

const date = "2026-11-11";
const hours = Array.from({ length: 24 }, (_, hour) => hour === 7 ? 2 : 0);
const row = {
  initiator: operator.id,
  queue: "4.1",
  todayDate: date,
  todayStatus: "ScheduleApplies",
  today: hours,
};

test("reads a fresh page token and sends it only to the regional endpoint", async () => {
  const html = `<script id="other">0</script><script type='application/json'
    id = 'site-access'>${JSON.stringify({ token: "test-token", expiresAt: Date.now() + 60_000 })}</script>`;
  const paths: string[] = [];
  const schedules = await fetchSchedules(new AbortController().signal, async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    paths.push(url.pathname);
    assert.equal(url.origin, "https://alerts.energy");
    assert.ok(init?.signal);
    assert.equal(headers.get("User-Agent"),
      "Mozilla/5.0 (Linux; Android 14; SM-A556B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36");

    if (paths.length === 1) {
      assert.equal(headers.get("x-request-hash"), null);
      return new Response(html);
    }

    assert.equal(headers.get("x-request-hash"), "test-token");
    assert.equal(headers.get("Referer"), "https://alerts.energy/kyivska-oblast/schedule/kyivska-oblast-oblenergo/4.1");
    assert.equal(init?.redirect, "error");
    return Response.json([row]);
  });
  assert.deepEqual(paths, [
    "/kyivska-oblast/schedule/kyivska-oblast-oblenergo/4.1",
    "/api/v1/source-registry/areas/kyivska-oblast/shutdowns",
  ]);
  assert.equal(schedules[0].date, date);
  assert.throws(() => parseSiteToken(html, Date.now() + 120_000), /expired/);
  assert.throws(() => parseSiteToken("<html></html>"), /Missing site-access/);

  await assert.rejects(fetchSchedules(new AbortController().signal, async () =>
    new Response(null, { status: 429, headers: { "Retry-After": "120" } })),
  (error) => error instanceof AlertsHttpError && error.retryAfterMs === 120_000);
  assert.equal(new AlertsHttpError(429, "Wed, 11 Nov 2026 00:02:00 GMT",
    Date.parse("2026-11-11T00:00:00Z")).retryAfterMs, 120_000);
});

test("uses source dates and keeps only the target operator across all queues", () => {
  const tomorrow = "2026-11-12";
  const planned = { date, status: "ScheduleApplies", hours, possible: [] };
  const emergency = Array<number>(24).fill(9);
  const schedules = parseSchedules([
    { ...row, initiator: "kyivska_oblast_uz" },
    {
      ...row, todayPossible: Array(24).fill(0), updated: "ignored",
      tomorrowDate: tomorrow, tomorrowStatus: "WaitingForSchedule", tomorrow: [],
    },
    {
      ...row, queue: "5.2",
      todayStatus: "EmergencyShutdowns", today: emergency,
      todayPublishedSchedule: { dateSlug: date, status: "ScheduleApplies", hours },
      tomorrowDate: "", tomorrow: [],
    },
    {
      initiator: operator.id, queue: "6.1", today_date: date, today_status: "NoShutdowns", today: Array(24).fill(0),
    },
  ]);
  assert.deepEqual(schedules, [
    { queue: "4.1", date, content: { status: "ScheduleApplies", hours, possible: [], publishedSchedule: null } },
    { queue: "4.1", date: tomorrow, content: { status: "WaitingForSchedule", hours: [], possible: [], publishedSchedule: null } },
    { queue: "5.2", date, content: { status: "EmergencyShutdowns", hours: emergency, possible: [], publishedSchedule: planned } },
    { queue: "6.1", date, content: { status: "NoShutdowns", hours: Array(24).fill(0), possible: [], publishedSchedule: null } },
  ]);
  assert.deepEqual(parseSchedules([]), []);
  assert.throws(() => parseSchedules({ data: [] }), /array/);
  assert.throws(() => parseSchedules([{ ...row, today: [1] }]), /hourly/);
  assert.throws(() => parseSchedules([{ ...row, todayDate: "2026-02-30" }]), /date/);
  assert.throws(() => parseSchedules([row, row]), /Duplicate/);
});

test("outage endpoints share Basic Auth and distinguish empty, stale and unavailable data", async (t) => {
  t.mock.method(console, "error", () => {});
  process.env.API_USERNAME = "homarr";
  process.env.API_PASSWORD = "test-password";
  const url = "http://localhost/api/v1/outages";
  const authorization = `Basic ${Buffer.from("homarr:test-password").toString("base64")}`;
  const request = (suffix = "") => new Request(url + suffix, { headers: { Authorization: authorization } });
  const fail = async () => { throw new Error("Database unavailable"); };

  for (const [route, controller] of [["", currentOutages], ["/history", outageHistory], ["/overview", outageOverview]] as const) {
    const unauthorized = await controller(new Request(url + route), fail);
    assert.equal(unauthorized.status, 401);
    assert.match(unauthorized.headers.get("WWW-Authenticate") ?? "", /^Basic /);
    assert.equal(unauthorized.headers.get("Cache-Control"), "no-store");
  }

  const now = new Date("2026-11-10T22:00:00.000Z");
  const empty = await currentOutages(request("?queue=4.1"), async (from, queue) => {
    assert.equal(from, date);
    assert.equal(queue, "4.1");
    return { schedules: [], lastSuccessfulPollAt: null };
  }, now);
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), {
    area: "kyivska-oblast", operator, timeZone: "Europe/Kyiv",
    schedules: [], lastSuccessfulPollAt: null, stale: null,
  });
  const lastSuccessfulPollAt = new Date(now.getTime() - 180_000);
  const stale = await currentOutages(request(), async () => ({
    schedules: [], lastSuccessfulPollAt,
  }), now);
  assert.equal((await stale.json()).stale, true);
  assert.equal((await currentOutages(request("?queue="), fail)).status, 400);
  assert.equal((await currentOutages(request("?queue=4.1&queue=4.2"), fail)).status, 400);
  assert.equal((await currentOutages(request(), fail)).status, 503);

  const suffix = `/history?date=${date}&queue=4.1`;
  const history = await outageHistory(request(suffix), async (requestedDate, queue) => {
    assert.equal(requestedDate, date);
    assert.equal(queue, "4.1");
    return [{ queue, date, status: "ScheduleApplies", hours, possible: [], publishedSchedule: null, observedAt: now }];
  });
  assert.equal(history.status, 200);
  assert.equal(history.headers.get("Cache-Control"), "no-store");
  assert.equal((await history.json()).versions[0].observedAt, now.toISOString());
  assert.deepEqual((await (await outageHistory(request(suffix), async () => [])).json()).versions, []);
  assert.equal((await outageHistory(request("/history?date=2026-02-30"), fail)).status, 400);
  assert.equal((await outageHistory(request("/history"), fail)).status, 400);
  assert.equal((await outageHistory(request(suffix), fail)).status, 503);
});

test("outage overview aligns today's charge and zones across the Kyiv clock change", async (t) => {
  t.mock.method(console, "error", () => {});
  process.env.API_USERNAME = "homarr";
  process.env.API_PASSWORD = "test-password";
  const authorization = `Basic ${Buffer.from("homarr:test-password").toString("base64")}`;
  const request = (query: string) => new Request("http://localhost/api/v1/outages/overview" + query, {
    headers: { Authorization: authorization },
  });
  const today = "2026-03-29";
  const now = new Date("2026-03-29T07:00:00Z");
  const window = telemetryWindow({ from: today, to: today });
  const schedule = {
    queue: "4.1", date: today, observedAt: now, status: "ScheduleApplies", publishedSchedule: null,
    hours: Array.from({ length: 24 }, (_, hour) => hour === 7 ? 2 : 0),
    possible: Array.from({ length: 24 }, (_, hour) => hour === 8 ? 3 : 0),
  } as const;
  const readOutages = async (queue: string | null) => {
    assert.equal(queue, "4.1");
    return {
      ...outageSource, lastSuccessfulPollAt: now, stale: false,
      schedules: [
        { ...schedule, hours: [...schedule.hours], possible: [...schedule.possible] },
        { ...schedule, date: "2026-03-31", status: "NoShutdowns" as const, hours: [], possible: [] },
      ],
    };
  };
  const readCharge = async (requestedDate: string) => {
    assert.equal(requestedDate, today);
    return {
      ...window,
      samples: [355, 360, 385, 730].map((minute, index) => ({
        time: window.start + minute * 60_000,
        socPct: [30, 25, 0, 75][index], batteryPowerW: null, gridPowerW: null, backupLoadPowerW: null,
      })),
    };
  };
  const read: typeof getOutageOverview = (queue, time) => getOutageOverview(queue, time, readOutages, readCharge);
  assert.equal((await outageOverview(request("?queue=4.1&queue=5.2"), read, now)).status, 400);
  const response = await outageOverview(request("?queue=4.1"), read, now);
  assert.equal(response.status, 200);
  const overview = await response.json();
  assert.deepEqual(overview.days.map(({ date }: { date: string }) => date), [today, "2026-03-30", "2026-03-31"]);
  assert.deepEqual(overview.days[0].intervals.find(({ kind }: { kind: string }) => kind === "outage"),
    { start: 420, end: 450, kind: "outage", range: "07:00–07:30" });
  assert.equal(overview.days[1].intervals[0].kind, "unknown");
  assert.equal(overview.charge.duration, 1380);
  assert.deepEqual(overview.charge.bands.find(({ kind }: { kind: string }) => kind === "outage"),
    { start: 360, end: 390, kind: "outage" });
  assert.deepEqual(overview.charge.points.map(({ socPct }: { socPct: number | null }) => socPct), [30, 25, null, 0]);
  assert.equal(overview.charge.last.time, "07:25");

  const scheduleOnly = await getOutageOverview("4.1", now, readOutages, async () => { throw new Error("No telemetry"); });
  assert.equal(scheduleOnly.days[0].status, "ScheduleApplies");
  assert.equal(scheduleOnly.charge, null);
});
