import assert from "node:assert/strict";
import test from "node:test";
import { AlertsHttpError, fetchSchedules, parseSiteToken } from "../src/server/outages/client.ts";
import { currentOutages, outageHistory } from "../src/server/outages/controller.ts";
import { operator, parseSchedules } from "../src/server/outages/schedules.ts";

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

    if (paths.length === 1) {
      assert.equal(headers.get("x-request-hash"), null);
      return new Response(html);
    }

    assert.equal(headers.get("x-request-hash"), "test-token");
    assert.equal(init?.redirect, "error");
    return Response.json([row]);
  });
  assert.deepEqual(paths, [
    "/kyivska-oblast/schedule/kyivska_oblast_oblenergo/4.1",
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

  for (const [route, controller] of [["", currentOutages], ["/history", outageHistory]] as const) {
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
