import type { DashboardPower, PowerEvent } from "./dashboard-feed.ts";

export type PowerInterval = { status: DashboardPower["status"]; start: number; end: number };

export function powerIntervals(
  events: PowerEvent[], start: number, end: number, now: number, checkedAt?: string, staleAfterMs?: number,
): PowerInterval[] {
  const through = Math.min(end, now);
  if (through <= start) return [];
  const points = events.flatMap(({ status, observedAt }) => {
    const time = Date.parse(observedAt);
    return Number.isFinite(time) ? [{ status, time }] : [];
  });
  if (checkedAt && staleAfterMs !== undefined) {
    const expires = Date.parse(checkedAt) + staleAfterMs;
    if (Number.isFinite(expires) && expires < now) points.push({ status: "unknown", time: expires });
  }
  points.sort((a, b) => a.time - b.time);
  let status: PowerInterval["status"] = "unknown";
  let cursor = start;
  const result: PowerInterval[] = [];
  for (const point of points) {
    if (point.time <= start) { status = point.status; continue; }
    if (point.time >= through) break;
    if (point.status === status) continue;
    result.push({ status, start: cursor, end: point.time });
    cursor = point.time;
    status = point.status;
  }
  result.push({ status, start: cursor, end: through });
  return result;
}
