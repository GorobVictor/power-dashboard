"use client";

import { CalendarClock, History, ZapOff } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, selectClassName } from "@/components/ui/input";
import type { DashboardSchedule } from "@/lib/dashboard-feed";
import { shiftTelemetryDate, telemetryWindow, type TelemetryHistory } from "@/lib/telemetry-history";
import { cn } from "@/lib/utils";
import { clockTime, kyivMinute, minutesPerDay, outageIntervals, outageQueues, scheduleBands, scheduleIntervals, type ScheduleInterval } from "@/server/outages/intervals";
import { isQueue, isScheduleDate, operator, timeZone, type ScheduleContent } from "@/server/outages/schedules";
import { useDashboardLive } from "./live";
import { mobilePanelClassName, StatusBadge, Timestamp } from "./panel";
import { compareSchedules } from "./schedule-insights";
import { ScheduleChargeChart } from "./telemetry";

const dateFormat = new Intl.DateTimeFormat("uk-UA", { timeZone, weekday: "long", day: "numeric", month: "long" });
const tabDateFormat = new Intl.DateTimeFormat("uk-UA", { timeZone, day: "numeric", month: "short" });
const statuses = {
  ScheduleApplies: { label: "Діє графік", tone: "warning" },
  WaitingForSchedule: { label: "Очікується графік", tone: "muted" },
  NoShutdowns: { label: "Без відключень", tone: "success" },
  EmergencyShutdowns: { label: "Аварійні обмеження", tone: "danger" },
} as const;
const queueStorageKey = "power-dashboard.outage-queue";
type Intervals = ReturnType<typeof outageIntervals>;
type ChargeHistory = { history: TelemetryHistory; now: number; emptyMessage: string };

const scheduleColors = {
  power: { label: "Зі світлом", background: "var(--card)" },
  outage: { label: "Без світла", background: "color-mix(in srgb, #9ca3af 38%, var(--card))" },
  possible: { label: "Можливе відключення", background: "repeating-linear-gradient(135deg, var(--schedule-unknown) 0 4px, var(--border) 4px 6px)" },
  unknown: { label: "Без даних", background: "var(--schedule-unknown)" },
} as const;

function ScheduleDate({ value }: { value: string }) {
  return <time dateTime={value}>{dateFormat.format(new Date(`${value}T00:00:00Z`))}</time>;
}

function ScheduleIntervals({ intervals, planned, possible }: { intervals: ScheduleInterval[]; planned: Intervals; possible: Intervals }) {
  const rows = [
    { kind: "power", times: intervals.filter(({ kind }) => kind === "power") },
    { kind: "outage", times: planned },
    { kind: "possible", times: possible },
    { kind: "unknown", times: intervals.filter(({ kind }) => kind === "unknown") },
  ] as const;
  return (
    <dl aria-label="Інтервали за графіком" className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2 gap-y-1 text-xs min-[400px]:gap-x-3">
      {rows.filter(({ times }) => times.length).map(({ kind, times }) => (
        <div key={kind} className="contents">
          <dt className="flex max-w-28 items-baseline gap-1.5 py-0.5 text-muted-foreground min-[400px]:max-w-none">
            <span aria-hidden="true" className="grid size-3.5 shrink-0 place-items-center self-start translate-y-0.5 rounded-xs text-foreground ring-1 ring-border" style={{ background: scheduleColors[kind].background }}>{kind === "outage" && <ZapOff className="size-3" />}</span>
            {kind === "possible" ? "Можливе" : scheduleColors[kind].label}
          </dt>
          <dd className="flex flex-wrap gap-x-2 gap-y-0.5 py-0.5 tabular-nums min-[400px]:gap-x-3">
            {times.map(({ start, end, kind: intervalKind }) => (
              <span key={start} className={cn("whitespace-nowrap", intervalKind === "emergency" && "text-danger")}>
                {clockTime(start)}–{clockTime(end)}{intervalKind === "emergency" && " · аварійні"}
              </span>
            ))}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ScheduleBands({ intervals, day }: { intervals: ScheduleInterval[]; day?: TelemetryHistory }) {
  const duration = day ? (day.end - day.start) / 60_000 : minutesPerDay;
  const bands = day ? scheduleBands(intervals, day) : intervals;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-sm ring-1 ring-inset ring-border">
      {bands.map(({ start, end, kind }) => (
        <span key={start} className="absolute inset-y-0 overflow-hidden"
          style={{ left: `${start / duration * 100}%`, width: `${(end - start) / duration * 100}%`, background: scheduleColors[kind].background }}>
          {kind === "outage" && <span className="absolute inset-0 flex items-center justify-center text-foreground/70"><ZapOff className="h-auto max-h-full w-full max-w-5 shrink-0" /></span>}
        </span>
      ))}
    </div>
  );
}

function ScheduleTimeline({ intervals, now }: { intervals: ScheduleInterval[]; now?: number }) {
  return (
    <div className="space-y-1">
      <div aria-hidden="true" className="relative h-4">
        <ScheduleBands intervals={intervals} />
        {now !== undefined && (
          <span title="Зараз" className="absolute inset-y-0 border-l border-dashed border-foreground"
            style={{ left: `${now / minutesPerDay * 100}%` }} />
        )}
      </div>
      <div className="flex justify-between text-[0.625rem] text-muted-foreground tabular-nums" aria-hidden="true">
        <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span>
      </div>
    </div>
  );
}

const unknownSchedule: ScheduleContent = { status: "WaitingForSchedule", hours: [], possible: [], publishedSchedule: null };

function ScheduleDetails({ schedule = unknownSchedule, now, charge, stale = false }: { schedule?: ScheduleContent; now?: number; charge?: ChargeHistory; stale?: boolean }) {
  const planned = schedule.status === "WaitingForSchedule" ? [] : outageIntervals(schedule.hours);
  const possible = outageIntervals(schedule.possible);
  const intervals = scheduleIntervals(schedule);
  const interval = now !== undefined && schedule.status === "ScheduleApplies"
    ? planned.find(({ end }) => end > now) : undefined;
  const ongoing = interval && now !== undefined && interval.start <= now;
  const published = schedule.publishedSchedule;
  const showTimeline = intervals.some(({ kind }) => kind !== "unknown");
  if (!charge && !showTimeline && !published) return null;

  return (
    <div className="space-y-2">
      {interval && (
        <p className="text-xs text-muted-foreground">
          {stale ? "За останнім отриманим графіком: " : ""}{ongoing ? "відключення до " : "наступне відключення "}
          <strong className="font-semibold text-foreground tabular-nums">
            {ongoing ? clockTime(interval.end) : `${clockTime(interval.start)}–${clockTime(interval.end)}`}
          </strong>
        </p>
      )}
      {charge ? <ScheduleChargeChart history={charge.history} overlay={{
        now: charge.now, emptyMessage: charge.emptyMessage, background: <ScheduleBands intervals={intervals} day={charge.history} />,
      }} /> : showTimeline && <ScheduleTimeline intervals={intervals} now={now} />}
      {(charge || showTimeline) && <ScheduleIntervals intervals={intervals} planned={planned} possible={possible} />}
      {published && (
        <details className="dashboard-details rounded-md border border-dashed">
          <summary className="cursor-pointer px-2.5 py-2 text-xs font-medium text-muted-foreground">Попередньо опублікований графік</summary>
          <div className="space-y-2 px-2.5 pb-2.5">
            <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs text-muted-foreground">
              <ScheduleDate value={published.date} />
              <ScheduleStatus status={published.status} />
            </div>
            <ScheduleIntervals intervals={scheduleIntervals(published)}
              planned={published.status === "WaitingForSchedule" ? [] : outageIntervals(published.hours)} possible={outageIntervals(published.possible)} />
          </div>
        </details>
      )}
    </div>
  );
}

function ScheduleStatus({ status }: { status: ScheduleContent["status"] }) {
  const { tone, label } = statuses[status];
  return <StatusBadge tone={tone}>{label}</StatusBadge>;
}

function updateHistoryDate(value: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("date", value);
  if (url.href !== window.location.href) window.history.pushState(null, "", url);
}

function readSavedQueue() {
  try {
    const saved = window.localStorage.getItem(queueStorageKey);
    return saved === "all" || isQueue(saved) ? saved : null;
  } catch {
    return null;
  }
}

function subscribeToSavedQueue(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

type QueueFilter = { queue: string | null; queues: string[]; selectQueue: (value: string) => void };

export function useOutageQueue() {
  const [selection, setSelection] = useState<string>();
  const saved = useSyncExternalStore(subscribeToSavedQueue, readSavedQueue, () => null);
  const { outages, today } = useDashboardLive();
  const schedules = outages?.schedules.filter((schedule) => schedule.date >= today) ?? [];
  const queues = outageQueues(schedules);
  const preferred = selection ?? saved;
  const queue = preferred === "all" ? null : preferred ?? queues[0] ?? null;
  if (queue && !queues.includes(queue)) queues.push(queue);

  function selectQueue(value: string) {
    setSelection(value);
    try {
      window.localStorage.setItem(queueStorageKey, value);
    } catch {
      // The in-memory selection still works if browser storage is unavailable.
    }
  }

  return { queue, queues, schedules, selectQueue };
}

function QueuePicker({ queue, queues, selectQueue, compact }: QueueFilter & { compact?: boolean }) {
  const id = useId();
  return (
    <div className="flex flex-wrap items-center justify-between gap-1.5">
      <label htmlFor={id} className={compact ? "sr-only" : "text-xs font-medium text-muted-foreground"}>Черга відключень</label>
      <select id={id} value={queue ?? "all"} onChange={(event) => selectQueue(event.target.value)}
        className={cn(selectClassName, "h-11 w-auto min-w-28 pl-2")}>
        {queues.map((value) => <option key={value} value={value}>Черга {value}</option>)}
        <option value="all">Усі черги</option>
      </select>
    </div>
  );
}

function ScheduleTabs({ id, dates, active, select }: { id: string; dates: string[]; active: string; select: (date: string) => void }) {
  return (
    <div role="tablist" aria-label="День відключень" className="flex min-w-0 gap-0.5 overflow-x-auto rounded-lg border bg-background p-0.5">
      {dates.map((date, index) => (
        <button key={date} id={`${id}-tab-${date}`} type="button" role="tab" tabIndex={date === active ? 0 : -1}
          aria-selected={date === active} aria-controls={`${id}-day-${date}`} onClick={() => select(date)}
          onKeyDown={(event) => {
            const next = event.key === "Home" ? 0 : event.key === "End" ? dates.length - 1
              : event.key === "ArrowLeft" ? (index + dates.length - 1) % dates.length
              : event.key === "ArrowRight" ? (index + 1) % dates.length : -1;
            if (next === -1) return;
            event.preventDefault();
            select(dates[next]);
            document.getElementById(`${id}-tab-${dates[next]}`)?.focus();
          }}
          className={cn("min-h-11 flex-1 cursor-pointer rounded-md px-3 text-xs font-semibold whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            date === active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
          {index === 0 ? "Сьогодні" : index === 1 ? "Завтра" : tabDateFormat.format(new Date(`${date}T00:00:00Z`))}
        </button>
      ))}
    </div>
  );
}

export function OutagesPanel({ schedules, onHistory, ...filter }: QueueFilter & { schedules: DashboardSchedule[]; onHistory: () => void }) {
  const { outages, outagesStale, today, now, connection, station, chargeHistory, historySupported, revision, request } = useDashboardLive();
  const { queue } = filter;
  const [selectedDate, setSelectedDate] = useState("");
  const tabsId = useId();
  const configured = station?.kind === "station";
  const showCharge = Boolean(queue && today);

  useEffect(() => {
    if (showCharge && configured && connection === "connected" && historySupported) {
      request({ type: "chargeHistory", date: today });
    }
  }, [showCharge, configured, connection, historySupported, today, revision, request]);

  const tomorrow = today ? shiftTelemetryDate(today, 1) : "";
  const dates = today ? [today, tomorrow, ...new Set(schedules.map(({ date }) => date).filter((date) => date > tomorrow).sort())] : [];
  const day = dates.includes(selectedDate) ? selectedDate : today;
  const queueSchedules = schedules.filter((schedule) => queue === null || schedule.queue === queue);
  const currentMinute = kyivMinute(now);
  const response = chargeHistory?.date === today ? chargeHistory : undefined;
  const todayCharge = showCharge ? {
    history: response?.value ?? { ...telemetryWindow({ from: today, to: today }), samples: [] },
    now,
    emptyMessage: station?.kind === "unconfigured" || station?.kind === "missing" ? "Історія з’явиться після налаштування станції."
      : response?.value ? "За сьогодні ще немає вимірів заряду."
      : response?.value === null ? "Не вдалося завантажити виміри заряду."
      : connection === "disconnected" ? "Очікуємо на відновлення з’єднання."
      : connection === "connected" && !historySupported ? "Історія вимірів недоступна."
      : "Завантажуємо виміри заряду…",
  } : undefined;
  const stale = outagesStale || connection !== "connected";
  const checkedAt = outages?.lastSuccessfulPollAt;
  const status = checkedAt ? { label: stale ? "Застарілі дані" : "Джерело актуальне", tone: stale ? "warning" : "success" } as const
    : connection === "disconnected" ? { label: "Дані недоступні", tone: "danger" } as const
    : { label: "Очікуємо дані", tone: "muted" } as const;

  return (
    <Card className={cn("gap-3 py-4", mobilePanelClassName)}>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight sm:text-lg">
            <span className="grid size-8 place-items-center rounded-lg bg-warning-surface text-warning">
              <CalendarClock aria-hidden="true" className="size-4" />
            </span>
            Відключення
          </h2>
          <div className="flex items-center gap-1"><QueuePicker {...filter} compact /><Button type="button" variant="ghost" onClick={onHistory} className="lg:hidden">Історія змін</Button></div>
        </div>
        {!!dates.length && <ScheduleTabs id={tabsId} dates={dates} active={day} select={setSelectedDate} />}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-2.5">
        {!day && <p role="status" className="text-sm text-muted-foreground">Очікуємо графіки від джерела…</p>}
        {/* On desktop, every date contributes to the shared row height. */}
        <div className="lg:grid">
          {dates.map((date) => {
            const active = day === date;
            const visible = queueSchedules.filter((schedule) => schedule.date === date);
            const charge = date === today ? todayCharge : undefined;
            const minute = date === today ? currentMinute : undefined;
            return (
              <div key={date} id={`${tabsId}-day-${date}`} role="tabpanel" aria-labelledby={`${tabsId}-tab-${date}`}
                inert={!active} tabIndex={active ? 0 : undefined}
                className={cn("min-w-0 space-y-2.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring lg:col-start-1 lg:row-start-1 lg:self-start",
                  !active && "hidden lg:invisible lg:block")}>
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <p className="text-xs text-muted-foreground first-letter:uppercase"><ScheduleDate value={date} /></p>
                  {queue !== null && visible[0] && <ScheduleStatus status={visible[0].status} />}
                  {charge && !visible.length && <StatusBadge tone="muted">Графік недоступний</StatusBadge>}
                </div>
                {!visible.length && (charge ? <ScheduleDetails now={minute} charge={charge} /> : (
                  <p role="status" className="py-1 text-sm text-muted-foreground">
                    {checkedAt ? "На цей день графіка ще немає."
                      : connection === "disconnected" ? "Очікуємо на відновлення з’єднання."
                      : "Очікуємо графіки від джерела…"}
                  </p>
                ))}
                {visible.map((schedule) => (
                  <article key={schedule.queue} className={queue === null ? "space-y-2 border-t pt-2" : undefined}>
                    {queue === null && (
                      <div className="flex flex-wrap items-center justify-between gap-1">
                        <CardTitle className="text-sm">Черга {schedule.queue}</CardTitle>
                        <ScheduleStatus status={schedule.status} />
                      </div>
                    )}
                    <ScheduleDetails schedule={schedule} now={minute} charge={charge} stale={stale} />
                  </article>
                ))}
              </div>
            );
          })}
        </div>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t pt-2">
          <p className="text-[0.6875rem] text-muted-foreground" title={operator.name}>
            ДТЕК · Київська область
            {checkedAt && <>{" · Перевірено "}<span title={dateFormat.format(new Date(checkedAt))}>
              <time className="tabular-nums" dateTime={checkedAt}>{clockTime(kyivMinute(Date.parse(checkedAt)))}</time>
            </span></>}
          </p>
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        </div>
      </CardContent>
    </Card>
  );
}

const versionTime = new Intl.DateTimeFormat("uk-UA", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit" });

function HistoryVersions({ versions }: { versions: DashboardSchedule[] }) {
  const [index, setIndex] = useState<number | null>(null);
  const active = Math.min(index ?? versions.length - 1, versions.length - 1);
  const version = versions[active];
  const previous = versions.slice(0, active).findLast((item) => item.queue === version.queue);
  const changes = previous ? compareSchedules(previous, version) : [];
  return (
    <div className="space-y-2.5">
      {versions.length > 1 && (
        <label className="grid min-w-0 gap-1 text-xs font-medium text-muted-foreground">Версія графіка
        <select value={active} onChange={(event) => {
          const selected = Number(event.target.value);
          setIndex(selected === versions.length - 1 ? null : selected);
        }} className={selectClassName}>
          {versions.map((entry, index) => (
            <option key={index} value={index}>
              Версія {index + 1} · {versionTime.format(new Date(entry.observedAt))}
            </option>
          )).reverse()}
        </select></label>
      )}
      <article className="space-y-2.5 rounded-lg border bg-background/50 p-3">
        <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
          <div>
            <CardTitle className="text-sm">Версія {active + 1} з {versions.length} · Черга {version.queue}</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground"><Timestamp value={version.observedAt} /></p>
          </div>
          <ScheduleStatus status={version.status} />
        </div>
        {previous && <div className="rounded-md bg-muted/55 p-2 text-xs"><p className="font-semibold">Зміни від попередньої версії</p>{changes.length ? <ul className="mt-1 space-y-1">{changes.map((change) => <li key={change}>{change}</li>)}</ul> : <p className="mt-1">Видимі інтервали та статус не змінилися.</p>}</div>}
        <ScheduleDetails key={`${version.queue}-${version.observedAt}-${active}`} schedule={version} />
      </article>
    </div>
  );
}

export function OutageHistoryPanel({ onBack, ...filter }: QueueFilter & { onBack: () => void }) {
  const { today, connection, historySupported, schedulesRevision, outageHistory, request } = useDashboardLive();
  const { queue } = filter;
  const dateParam = useSearchParams().get("date");
  const date = dateParam === null ? today : isScheduleDate(dateParam) ? dateParam : "";
  const history = outageHistory?.date === date && outageHistory.queue === queue ? outageHistory.value : undefined;

  useEffect(() => {
    if (date && connection === "connected" && historySupported) request({ type: "outageHistory", date, queue });
  }, [connection, date, historySupported, queue, request, schedulesRevision]);

  const message = dateParam !== null && !date ? "Виберіть коректну дату графіка."
    : history?.length === 0 ? "За вибрану дату немає збережених версій."
    : connection === "disconnected" ? "Очікуємо на відновлення з’єднання."
    : connection === "connected" && !historySupported ? "Щоб завантажити історію, перезапустіть вебсервер."
    : history === null ? "Історія тимчасово недоступна." : "Завантажуємо історію…";

  return (
    <Card className={cn("gap-3 py-4", mobilePanelClassName)}>
      <CardHeader className="gap-2.5">
        <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight sm:text-lg">
          <span className="grid size-8 place-items-center rounded-lg bg-muted text-warning">
            <History aria-hidden="true" className="size-4" />
          </span>
          Історія відключень
        </h2>
        <Button type="button" variant="ghost" onClick={onBack} className="w-fit lg:hidden">← До графіка</Button>
        <QueuePicker {...filter} />
      </CardHeader>
      <CardContent className="space-y-2.5">
        <form className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2" onSubmit={(event) => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get("date");
          if (!isScheduleDate(value)) return;
          if (value === date && history === null && connection === "connected" && historySupported) {
            request({ type: "outageHistory", date, queue });
          }
          updateHistoryDate(value);
        }}>
          <div className="grid min-w-0 gap-1">
            <label htmlFor="history-date" className="text-xs font-medium text-muted-foreground">Дата графіка</label>
            <Input id="history-date" name="date" key={date} type="date" required defaultValue={date} />
          </div>
          <Button type="submit" variant="outline" className="px-3">Показати</Button>
        </form>
        {history?.length ? <HistoryVersions key={`${date}-${queue}`} versions={history} /> : (
          <p role="status" className="grid min-h-20 place-items-center rounded-lg border border-dashed p-3 text-center text-sm text-muted-foreground">
            {message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
