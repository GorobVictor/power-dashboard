"use client";

import { CalendarClock, History } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, inputClassName } from "@/components/ui/input";
import type { DashboardSchedule } from "@/lib/dashboard-feed";
import { cn } from "@/lib/utils";
import { isQueue, isScheduleDate, operator, timeZone, type ScheduleContent } from "@/server/outages/schedules";
import { useDashboardLive } from "./live";
import { clockTime, outageIntervals, outageQueues } from "./outage-intervals";
import { mobilePanelClassName, StatusBadge, Timestamp } from "./panel";

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
            <StatusBadge tone={kind === "emergency" ? "danger" : possible ? "muted" : "warning"} className="max-sm:px-1.5">
              {`${clockTime(start)}–${clockTime(end)}${kind === "emergency" ? " · Аварійні" : ""}`}
            </StatusBadge>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ScheduleTimeline({ planned, possible, now }: { planned: Intervals; possible: Intervals; now?: number }) {
  if (!planned.length && !possible.length) return null;
  return (
    <div className="space-y-1">
      <div aria-hidden="true" className="relative h-3.5 rounded-md border bg-muted/65">
        {planned.map(({ start, end, kind }) => (
          <span key={start} className={cn("absolute inset-y-px rounded-[2px]", kind === "emergency" ? "bg-danger/80" : "bg-warning/65")}
            style={{ left: `${start / minutesPerDay * 100}%`, width: `${(end - start) / minutesPerDay * 100}%` }} />
        ))}
        {possible.map(({ start, end, kind }) => (
          <span key={start} className={cn("absolute inset-y-px rounded-[2px] border border-dashed", kind === "emergency" ? "border-danger" : "border-muted-foreground")}
            style={{ left: `${start / minutesPerDay * 100}%`, width: `${(end - start) / minutesPerDay * 100}%` }} />
        ))}
        {now !== undefined && (
          <span className="absolute -inset-y-1 z-10 w-0.5 -translate-x-1/2 rounded-full bg-foreground ring-1 ring-card"
            style={{ left: `${now / minutesPerDay * 100}%` }} />
        )}
      </div>
      <div className="flex justify-between text-[0.625rem] text-muted-foreground tabular-nums" aria-hidden="true">
        <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span>
      </div>
    </div>
  );
}

function ScheduleDetails({ schedule, now }: { schedule: ScheduleContent; now?: number }) {
  const planned = outageIntervals(schedule.hours);
  const possible = outageIntervals(schedule.possible);
  const interval = now !== undefined && schedule.status === "ScheduleApplies"
    ? planned.find(({ end }) => end > now) : undefined;
  const ongoing = interval && now !== undefined && interval.start <= now;
  const published = schedule.publishedSchedule;
  if (!planned.length && !possible.length && !published) return null;

  return (
    <div className="dashboard-enter space-y-2.5">
      {now !== undefined && schedule.status === "ScheduleApplies" && planned.length > 0 && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 rounded-md bg-warning-surface/70 px-2.5 py-1.5 text-xs text-warning">
          {interval ? (
            <>
              <span>{ongoing ? "Зараз за графіком" : "Наступне за графіком"}</span>
              <strong className="font-semibold tabular-nums">
                {ongoing ? `до ${clockTime(interval.end)}` : `${clockTime(interval.start)}–${clockTime(interval.end)}`}
              </strong>
            </>
          ) : <span>На сьогодні інтервали завершились</span>}
        </div>
      )}
      <ScheduleTimeline planned={planned} possible={possible} now={now} />
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

function updateFilter(key: "queue" | "date", value: string) {
  const url = new URL(window.location.href);
  url.searchParams.set(key, value);
  if (url.href !== window.location.href) window.history.pushState(null, "", url);
}

function useOutageFilters() {
  const params = useSearchParams();
  const { outages, today } = useDashboardLive();
  const schedules = outages?.schedules.filter((schedule) => schedule.date >= today) ?? [];
  const queues = outageQueues(schedules);
  const queueParam = params.get("queue");
  const queue = queueParam === "all" ? null : isQueue(queueParam) ? queueParam : queues[0] ?? null;
  if (queue && !queues.includes(queue)) queues.push(queue);
  return { queue, queueParam, queues, schedules, dateParam: params.get("date") };
}

function QueuePicker({ queue, queues }: { queue: string | null; queues: string[] }) {
  const id = useId();
  return (
    <div className="flex flex-wrap items-center justify-between gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">Черга відключень</label>
      <select id={id} value={queue ?? "all"} onChange={(event) => updateFilter("queue", event.target.value)}
        className={cn(inputClassName, "h-9 w-auto min-w-28 px-2")}>
        {queues.map((value) => <option key={value} value={value}>Черга {value}</option>)}
        <option value="all">Усі черги</option>
      </select>
    </div>
  );
}

export function OutagesPanel() {
  const { outages, outagesStale, today, now, connection } = useDashboardLive();
  const { queue, queueParam, queues, schedules } = useOutageFilters();

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("queue") !== queueParam) return;

    try {
      if (queueParam === "all" || isQueue(queueParam)) {
        window.localStorage.setItem(queueStorageKey, queueParam);
        return;
      }

      const saved = window.localStorage.getItem(queueStorageKey);
      if (saved === "all" || isQueue(saved)) {
        url.searchParams.set("queue", saved);
        window.history.replaceState(null, "", url);
      }
    } catch {
      // Queue selection still works through the URL if browser storage is unavailable.
    }
  }, [queueParam]);

  const visible = schedules.filter((schedule) => queue === null || schedule.queue === queue);
  const tomorrow = today ? new Date(Date.parse(today) + 86_400_000).toISOString().slice(0, 10) : "";
  const [hour, minute] = kyivTime.format(now).split(":").map(Number);
  const currentMinute = hour * 60 + minute;
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
        <QueuePicker queue={queue} queues={queues} />
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-2.5">
        {!visible.length && (
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
              <ScheduleDetails key={schedule.observedAt} schedule={schedule} now={isToday ? currentMinute : undefined} />
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

export function OutageHistoryPanel() {
  const { today, connection, historySupported, schedulesRevision, outageHistory, request } = useDashboardLive();
  const { queue, queues, dateParam } = useOutageFilters();
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
        <QueuePicker queue={queue} queues={queues} />
      </CardHeader>
      <CardContent className="space-y-2.5">
        <form className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2" onSubmit={(event) => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get("date");
          if (!isScheduleDate(value)) return;
          if (value === date && history === null && connection === "connected" && historySupported) {
            request({ type: "outageHistory", date, queue });
          }
          updateFilter("date", value);
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
