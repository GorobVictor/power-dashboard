"use client";

import { CalendarClock, History } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, inputClassName } from "@/components/ui/input";
import type { DashboardSchedule } from "@/lib/dashboard-feed";
import { telemetryWindow, type TelemetryHistory } from "@/lib/telemetry-history";
import { cn } from "@/lib/utils";
import { clockTime, outageIntervals, outageQueues, scheduleIntervals, type ScheduleInterval } from "@/server/outages/intervals";
import { isQueue, isScheduleDate, operator, timeZone, type ScheduleContent } from "@/server/outages/schedules";
import { useDashboardLive } from "./live";
import { mobilePanelClassName, StatusBadge, Timestamp } from "./panel";
import { ScheduleChargeChart } from "./telemetry";

const dateFormat = new Intl.DateTimeFormat("uk-UA", { timeZone, weekday: "long", day: "numeric", month: "long" });
const kyivTime = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const statuses = {
  ScheduleApplies: { label: "Діє графік", tone: "warning" },
  WaitingForSchedule: { label: "Очікується графік", tone: "muted" },
  NoShutdowns: { label: "Без відключень", tone: "success" },
  EmergencyShutdowns: { label: "Аварійні обмеження", tone: "danger" },
} as const;
const minutesPerDay = 24 * 60;
const queueStorageKey = "power-dashboard.outage-queue";
type Intervals = ReturnType<typeof outageIntervals>;
type ChargeHistory = { history: TelemetryHistory; now: number; emptyMessage: string };

const scheduleColors = {
  power: { label: "Зі світлом", fill: "bg-[var(--schedule-power)]" },
  outage: { label: "Без світла", fill: "bg-[var(--schedule-outage)]" },
  possible: { label: "Можливе відключення", fill: "schedule-possible" },
  unknown: { label: "Без даних", fill: "bg-[var(--schedule-unknown)]" },
} as const;

function kyivMinute(time: number) {
  const [hour, minute] = kyivTime.format(time).split(":").map(Number);
  return hour * 60 + minute;
}

function ScheduleDate({ value }: { value: string }) {
  return <time dateTime={value}>{dateFormat.format(new Date(`${value}T00:00:00Z`))}</time>;
}

function IntervalList({ intervals, possible = false }: { intervals: Intervals; possible?: boolean }) {
  if (!intervals.length) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{possible ? "Можливі відключення" : "Інтервали відключень"}</p>
      <ul className="flex flex-wrap gap-1.5">
        {intervals.map(({ start, end, kind }) => (
          <li key={start} className="tabular-nums">
            <StatusBadge tone={kind === "emergency" ? "danger" : "muted"} className="max-sm:px-1.5">
              {`${clockTime(start)}–${clockTime(end)}${kind === "emergency" ? " · Аварійні" : ""}`}
            </StatusBadge>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ScheduleBands({ intervals, day }: { intervals: ScheduleInterval[]; day?: TelemetryHistory }) {
  const duration = day ? (day.end - day.start) / 60_000 : minutesPerDay;
  let bands = intervals;
  if (day && duration !== minutesPerDay) {
    // The schedule uses Kyiv clock hours, while measurements use elapsed time.
    bands = [];
    for (let start = 0; start < duration; start += 30) {
      const minute = kyivMinute(day.start + start * 60_000);
      const kind = intervals.find((interval) => interval.start <= minute && minute < interval.end)?.kind ?? "unknown";
      const previous = bands.at(-1);
      if (previous?.kind === kind) previous.end = start + 30;
      else bands.push({ start, end: start + 30, kind });
    }
  }
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-sm ring-1 ring-inset ring-border">
      {bands.map(({ start, end, kind }) => (
        <span key={start} className={cn("absolute inset-y-0", scheduleColors[kind].fill)}
          style={{ left: `${start / duration * 100}%`, width: `${(end - start) / duration * 100}%` }} />
      ))}
    </div>
  );
}

function ScheduleLegend({ intervals, showNow }: { intervals: ScheduleInterval[]; showNow: boolean }) {
  return (
    <ul aria-label="Позначення графіка відключень" className="flex flex-wrap gap-x-3 gap-y-1 text-[0.6875rem] text-muted-foreground">
      {(Object.keys(scheduleColors) as ScheduleInterval["kind"][]).filter((kind) => intervals.some((interval) => interval.kind === kind)).map((kind) => (
        <li key={kind} className="flex items-center gap-1.5">
          <span aria-hidden="true" className={cn("size-2.5 rounded-[2px] border", scheduleColors[kind].fill)} />
          {scheduleColors[kind].label}
        </li>
      ))}
      {showNow && <li className="flex items-center gap-1.5"><span aria-hidden="true" className="h-2.5 border-l border-dashed border-foreground" />Зараз</li>}
    </ul>
  );
}

function ScheduleTimeline({ intervals, now }: { intervals: ScheduleInterval[]; now?: number }) {
  return (
    <div className="space-y-1">
      <div aria-hidden="true" className="relative h-4">
        <ScheduleBands intervals={intervals} />
        {now !== undefined && (
          <span className="absolute inset-y-0 border-l border-dashed border-foreground"
            style={{ left: `${now / minutesPerDay * 100}%` }} />
        )}
      </div>
      <div className="flex justify-between text-[0.625rem] text-muted-foreground tabular-nums" aria-hidden="true">
        <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span>
      </div>
    </div>
  );
}

function PowerIntervals({ intervals }: { intervals: ScheduleInterval[] }) {
  const power = intervals.filter(({ kind }) => kind === "power");
  if (!power.length) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">Години зі світлом за графіком</p>
      <ul className="flex flex-wrap gap-1.5">
        {power.map(({ start, end }) => (
          <li key={start} className="tabular-nums">
            <StatusBadge tone="warning" className="max-sm:px-1.5">{`${clockTime(start)}–${clockTime(end)}`}</StatusBadge>
          </li>
        ))}
      </ul>
    </div>
  );
}

const unknownSchedule: ScheduleContent = { status: "WaitingForSchedule", hours: [], possible: [], publishedSchedule: null };

function ScheduleDetails({ schedule = unknownSchedule, now, charge }: { schedule?: ScheduleContent; now?: number; charge?: ChargeHistory }) {
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
    <div className="dashboard-enter space-y-2.5">
      {now !== undefined && schedule.status === "ScheduleApplies" && planned.length > 0 && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 rounded-md bg-muted px-2.5 py-1.5 text-xs text-foreground">
          {interval ? (
            <>
              <span>{ongoing ? "Зараз відключення за графіком" : "Наступне відключення за графіком"}</span>
              <strong className="font-semibold tabular-nums">
                {ongoing ? `до ${clockTime(interval.end)}` : `${clockTime(interval.start)}–${clockTime(interval.end)}`}
              </strong>
            </>
          ) : <span>На сьогодні інтервали завершились</span>}
        </div>
      )}
      {charge ? <ScheduleChargeChart history={charge.history} overlay={{
        now: charge.now, emptyMessage: charge.emptyMessage, background: <ScheduleBands intervals={intervals} day={charge.history} />,
      }} /> : showTimeline && <ScheduleTimeline intervals={intervals} now={now} />}
      {(charge || showTimeline) && <ScheduleLegend intervals={intervals} showNow={now !== undefined} />}
      <PowerIntervals intervals={intervals} />
      <IntervalList intervals={planned} />
      <IntervalList intervals={possible} possible />
      {published && (
        <details className="dashboard-details rounded-md border border-dashed">
          <summary className="cursor-pointer px-2.5 py-2 text-xs font-medium text-muted-foreground">Попередньо опублікований графік</summary>
          <div className="space-y-2 px-2.5 pb-2.5">
            <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs text-muted-foreground">
              <ScheduleDate value={published.date} />
              <ScheduleStatus status={published.status} />
            </div>
            <PowerIntervals intervals={scheduleIntervals(published)} />
            <IntervalList intervals={outageIntervals(published.hours)} />
            <IntervalList intervals={outageIntervals(published.possible)} possible />
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

function QueuePicker({ queue, queues, selectQueue }: QueueFilter) {
  const id = useId();
  return (
    <div className="flex flex-wrap items-center justify-between gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">Черга відключень</label>
      <select id={id} value={queue ?? "all"} onChange={(event) => selectQueue(event.target.value)}
        className={cn(inputClassName, "h-9 w-auto min-w-28 px-2")}>
        {queues.map((value) => <option key={value} value={value}>Черга {value}</option>)}
        <option value="all">Усі черги</option>
      </select>
    </div>
  );
}

export function OutagesPanel({ schedules, ...filter }: QueueFilter & { schedules: DashboardSchedule[] }) {
  const { outages, outagesStale, today, now, connection, station, chargeHistory, historySupported, revision, request } = useDashboardLive();
  const { queue } = filter;
  const configured = station?.kind === "station";
  const showCharge = Boolean(queue && today);

  useEffect(() => {
    if (showCharge && configured && connection === "connected" && historySupported) {
      request({ type: "chargeHistory", date: today });
    }
  }, [showCharge, configured, connection, historySupported, today, revision, request]);

  const visible = schedules.filter((schedule) => queue === null || schedule.queue === queue);
  const tomorrow = today ? new Date(Date.parse(today) + 86_400_000).toISOString().slice(0, 10) : "";
  const currentMinute = kyivMinute(now);
  const response = chargeHistory?.date === today ? chargeHistory : undefined;
  const charge = showCharge ? {
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
      <CardHeader className="gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight sm:text-lg">
            <span className="grid size-8 place-items-center rounded-lg bg-warning-surface text-warning">
              <CalendarClock aria-hidden="true" className="size-4" />
            </span>
            Відключення
          </h2>
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        </div>
        <QueuePicker {...filter} />
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-2.5">
        {charge && !visible.some(({ date }) => date === today) && (
          <article className="space-y-2.5 rounded-lg border bg-background/50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <CardTitle className="text-sm">Сьогодні</CardTitle>
              <StatusBadge tone="muted">Графік недоступний</StatusBadge>
            </div>
            <ScheduleDetails now={currentMinute} charge={charge} />
          </article>
        )}
        {!visible.length && !charge && (
          <p role="status" className="grid min-h-24 place-items-center rounded-lg border border-dashed p-3 text-center text-sm text-muted-foreground">
            {checkedAt ? "Немає актуальних графіків для цієї черги."
              : connection === "disconnected" ? "Очікуємо на відновлення з’єднання."
              : "Очікуємо графіки від джерела…"}
          </p>
        )}
        {visible.map((schedule) => {
          const isToday = schedule.date === today;
          return (
            <article key={`${schedule.queue}-${schedule.date}`} className="space-y-2.5 rounded-lg border bg-background/50 p-3">
              <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
                <div>
                  <CardTitle className="text-sm">
                    {isToday ? "Сьогодні" : schedule.date === tomorrow ? "Завтра" : <ScheduleDate value={schedule.date} />}
                    {queue === null && <span className="font-medium text-muted-foreground"> · Черга {schedule.queue}</span>}
                  </CardTitle>
                  {(isToday || schedule.date === tomorrow) && (
                    <p className="mt-0.5 text-xs text-muted-foreground first-letter:uppercase"><ScheduleDate value={schedule.date} /></p>
                  )}
                </div>
                <ScheduleStatus status={schedule.status} />
              </div>
              <ScheduleDetails schedule={schedule} now={isToday ? currentMinute : undefined} charge={isToday ? charge : undefined} />
            </article>
          );
        })}
        <p className="mt-auto pt-0.5 text-[0.6875rem] leading-relaxed text-muted-foreground" title={operator.name}>
          ДТЕК · Київська область
          {checkedAt && (
            <>
              {" · Перевірено "}
              <time className="tabular-nums sm:hidden" dateTime={checkedAt}>{kyivTime.format(new Date(checkedAt))}</time>
              <span className="hidden sm:inline"><Timestamp value={checkedAt} /></span>
            </>
          )}
        </p>
      </CardContent>
    </Card>
  );
}

const versionTime = new Intl.DateTimeFormat("uk-UA", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit" });

function HistoryVersions({ versions }: { versions: DashboardSchedule[] }) {
  const [index, setIndex] = useState<number | null>(null);
  const active = Math.min(index ?? versions.length - 1, versions.length - 1);
  const version = versions[active];
  return (
    <div className="space-y-2.5">
      {versions.length > 1 && (
        <select aria-label="Версія графіка" value={active} onChange={(event) => {
          const selected = Number(event.target.value);
          setIndex(selected === versions.length - 1 ? null : selected);
        }} className={inputClassName}>
          {versions.map((entry, index) => (
            <option key={index} value={index}>
              Версія {index + 1} · {versionTime.format(new Date(entry.observedAt))} · Черга {entry.queue}
            </option>
          )).reverse()}
        </select>
      )}
      <article className="space-y-2.5 rounded-lg border bg-background/50 p-3">
        <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
          <div>
            <CardTitle className="text-sm">Версія {active + 1} з {versions.length} · Черга {version.queue}</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground"><Timestamp value={version.observedAt} /></p>
          </div>
          <ScheduleStatus status={version.status} />
        </div>
        <ScheduleDetails key={`${version.queue}-${version.observedAt}-${active}`} schedule={version} />
      </article>
    </div>
  );
}

export function OutageHistoryPanel(filter: QueueFilter) {
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
