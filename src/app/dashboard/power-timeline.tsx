"use client";

import { powerIntervals } from "@/lib/power-history";
import { cn } from "@/lib/utils";
import { useDashboardLive } from "./live";

const colors = { online: "var(--success)", offline: "var(--danger)", unknown: "var(--muted-foreground)" } as const;
const labels = { online: "Світло є", offline: "Світла немає", unknown: "Невідомо" } as const;
const dateTime = new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const week = 7 * 24 * 60 * 60 * 1_000;

function usePowerIntervals(start: number, end: number) {
  const { power, powerHistory, now } = useDashboardLive();
  const historical = powerHistory?.start === start && powerHistory.end === end ? powerHistory.value : undefined;
  const recent = power?.events ?? [];
  // Recent snapshots include one event before the seven-day window; apply it only within that window.
  const boundary = now - week;
  const before = recent.filter((event) => Date.parse(event.observedAt) < boundary).at(-1);
  const events = historical ? [...historical] : [];
  if (!historical && start < boundary) {
    events.push({ status: "unknown", observedAt: new Date(start).toISOString() });
    if (before) events.push({ status: before.status, observedAt: new Date(boundary).toISOString() });
  } else if (!historical && before) events.push(before);
  events.push(...recent.filter((event) => Date.parse(event.observedAt) >= boundary));
  const unique = [...new Map(events.map((event) => [`${event.observedAt}:${event.status}`, event])).values()];
  const intervals = now ? powerIntervals(unique, start, end, now, power?.checkedAt, power?.staleAfterMs) : [];
  return { intervals, now };
}

export function PowerChartOverlay({ start, end }: { start: number; end: number }) {
  const { intervals } = usePowerIntervals(start, end);
  return <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-sm">
    {intervals.map(({ status, start: from, end: to }) => <span key={from} className="absolute inset-y-0"
      style={{ left: `${(from - start) / (end - start) * 100}%`, width: `${(to - from) / (end - start) * 100}%`, background: `color-mix(in srgb, ${colors[status]} ${status === "offline" ? 20 : 12}%, transparent)` }}>
    </span>)}
  </div>;
}

export function PowerChartLegend({ start, end, selected, compact, flush = false }: { start: number; end: number; selected?: number; compact: boolean; flush?: boolean }) {
  const { intervals, now } = usePowerIntervals(start, end);
  const time = selected ?? now;
  const status = intervals.find((item) => item.start <= time && time < item.end)?.status
    ?? (selected === undefined && time === now ? intervals.at(-1)?.status : undefined);
  return <div className={cn("mt-2 grid gap-x-1.5", flush ? "grid-cols-[0_minmax(0,1fr)] gap-x-0" : compact ? "grid-cols-[1.55rem_minmax(0,1fr)]" : "grid-cols-[2.5rem_minmax(0,1fr)] sm:grid-cols-[3.15rem_minmax(0,1fr)]")}>
    <div className="col-start-2 space-y-1">
      <div className="flex flex-wrap justify-between gap-x-2 text-[0.6875rem] text-muted-foreground">
        <span>За розеткою</span>
        {status && time >= start && time <= end && <span style={{ color: colors[status] }}>{selected !== undefined ? "На вибраний час: " : "Зараз: "}{labels[status]}</span>}
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[0.625rem] text-muted-foreground" aria-label="Позначення наявності світла за розеткою">
        {(["online", "offline", "unknown"] as const).map((status) => <li key={status} className="flex items-center gap-1"><span aria-hidden="true" className="size-2 rounded-xs" style={{ background: colors[status] }} />{labels[status]}</li>)}
      </ul>
      <ul className="sr-only" aria-label="Інтервали за даними розетки">{intervals.map((interval) => <li key={interval.start}>{labels[interval.status]}: {dateTime.format(interval.start)} – {dateTime.format(interval.end)}</li>)}</ul>
    </div>
  </div>;
}
