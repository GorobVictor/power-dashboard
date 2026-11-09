"use client";

import { ChevronDown, History } from "lucide-react";
import Form from "next/form";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, inputClassName } from "@/components/ui/input";
import { operator, timeZone, type ScheduleContent } from "@/server/outages/schedules";
import { CardCarousel } from "./card-carousel";
import { useDashboardLive } from "./live";
import { clockTime, outageIntervals, outageQueues } from "./outage-intervals";
import { PanelSkeleton, StatusBadge, Timestamp } from "./panel";

const dateFormat = new Intl.DateTimeFormat("uk-UA", {
  timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric",
});
const statuses = {
  ScheduleApplies: { label: "Діє графік", tone: "warning" },
  WaitingForSchedule: { label: "Очікується графік", tone: "muted" },
  NoShutdowns: { label: "Без відключень", tone: "success" },
  EmergencyShutdowns: { label: "Аварійні обмеження", tone: "danger" },
} as const;
const minutesPerDay = 24 * 60;

function ScheduleDate({ value }: { value: string }) {
  return <time dateTime={value}>{dateFormat.format(new Date(`${value}T00:00:00Z`))}</time>;
}

function Intervals({ hours, possible = false }: { hours: ScheduleContent["hours"]; possible?: boolean }) {
  const intervals = outageIntervals(hours);
  if (!intervals.length) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">
        {possible ? "Можливі відключення" : "Інтервали відключень"}
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {intervals.map(({ start, end, kind }) => (
          <li key={start} className="tabular-nums">
            <StatusBadge tone={kind === "emergency" ? "danger" : possible ? "muted" : "warning"}>
              {`${clockTime(start)}–${clockTime(end)}${kind === "emergency" ? " · Аварійні" : ""}`}
            </StatusBadge>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ScheduleTimeline({ hours, possible }: Pick<ScheduleContent, "hours" | "possible">) {
  if (!hours.length && !possible.length) return null;

  return (
    <div aria-hidden="true" className="rounded-lg bg-muted/50 px-2.5 py-2">
      <div className="relative h-4 overflow-hidden rounded-sm bg-card">
        {outageIntervals(hours).map(({ start, end, kind }) => (
          <span key={start} className={`absolute inset-y-0 ${kind === "emergency" ? "bg-danger" : "bg-warning/60"}`}
            style={{ left: `${start / minutesPerDay * 100}%`, right: `${(minutesPerDay - end) / minutesPerDay * 100}%` }} />
        ))}
        {outageIntervals(possible).map(({ start, end, kind }) => (
          <span key={start} className={`absolute bottom-0 h-1 border-t border-dashed ${kind === "emergency" ? "bg-danger" : "bg-muted-foreground/65"}`}
            style={{ left: `${start / minutesPerDay * 100}%`, right: `${(minutesPerDay - end) / minutesPerDay * 100}%` }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[0.625rem] text-muted-foreground tabular-nums">
        <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span>
      </div>
    </div>
  );
}

function ScheduleDay({ day }: { day: Pick<ScheduleContent, "status" | "hours" | "possible"> }) {
  const { label, tone } = statuses[day.status];
  return (
    <div className="space-y-3">
      <StatusBadge tone={tone}>{label}</StatusBadge>
      <Intervals hours={day.hours} />
      <Intervals hours={day.possible} possible />
    </div>
  );
}

export function ScheduleDetails({ schedule, showTimeline = false }: { schedule: ScheduleContent; showTimeline?: boolean }) {
  return (
    <div className="space-y-4">
      {showTimeline && <ScheduleTimeline hours={schedule.hours} possible={schedule.possible} />}
      <ScheduleDay day={schedule} />
      {schedule.publishedSchedule && (
        <div className="space-y-2 rounded-lg border border-dashed p-3">
          <p className="text-sm font-medium">Попередньо опублікований графік</p>
          <p className="text-xs text-muted-foreground"><ScheduleDate value={schedule.publishedSchedule.date} /></p>
          <ScheduleDay day={schedule.publishedSchedule} />
        </div>
      )}
    </div>
  );
}

export function OutagesPanel({ date, requestedQueue, historyOpen, history }: {
  date: string | null;
  requestedQueue: string | null | undefined;
  historyOpen: boolean;
  history: ReactNode;
}) {
  const { outages: current, outagesStale, today, connection } = useDashboardLive();
  if (!current && connection === "connecting") return <PanelSkeleton label="Завантаження графіків відключень" />;

  const tomorrow = today ? new Date(Date.parse(today) + 86_400_000).toISOString().slice(0, 10) : "";
  const currentSchedules = current?.schedules.filter((schedule) => schedule.date >= today) ?? [];
  const queues = outageQueues(currentSchedules);
  const queue = requestedQueue === undefined ? queues[0] ?? null : requestedQueue;
  if (queue && !queues.includes(queue)) queues.push(queue);
  const selectedQueue = queue ?? "all";
  const schedules = currentSchedules.filter((schedule) => queue === null || schedule.queue === queue);

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-lg">Актуальний графік</CardTitle>
            {current?.lastSuccessfulPollAt && (outagesStale
              ? <StatusBadge tone="warning">Застарілий графік</StatusBadge>
              : <StatusBadge tone="success">Джерело оновлено</StatusBadge>)}
            {current?.lastSuccessfulPollAt === null && <StatusBadge tone="muted">Очікуємо дані</StatusBadge>}
            {!current && <StatusBadge tone="danger">Дані недоступні</StatusBadge>}
          </div>
          <CardDescription>{operator.name} · київський час</CardDescription>
          {current?.lastSuccessfulPollAt && (
            <p className="text-xs text-muted-foreground">
              Останнє успішне опитування <Timestamp value={current.lastSuccessfulPollAt} />
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          <Form action="/" scroll={false} className="flex flex-wrap items-end gap-2">
            {date && <input type="hidden" name="date" value={date} />}
            <div className="grid min-w-0 flex-1 gap-1.5 sm:max-w-56">
              <label htmlFor="queue" className="text-sm font-medium">Черга відключень</label>
              <select id="queue" name="queue" key={selectedQueue} defaultValue={selectedQueue} className={inputClassName}>
                {queues.map((value) => <option key={value} value={value}>Черга {value}</option>)}
                <option value="all">Усі черги</option>
              </select>
            </div>
            <Button type="submit" variant="outline">Застосувати</Button>
          </Form>
          {!current && <p className="text-sm text-danger">Графіки тимчасово недоступні. Спробуйте оновити дашборд.</p>}
          {current?.lastSuccessfulPollAt === null && (
            <p className="text-sm text-muted-foreground">Ще немає успішного опитування джерела.</p>
          )}
          {current?.lastSuccessfulPollAt && schedules.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {queue ? "Для вибраної черги немає актуального графіка." : "Немає актуальних графіків."}
            </p>
          )}
        </CardContent>
      </Card>
      <CardCarousel label="Графіки відключень" key={selectedQueue} slides={schedules.map((schedule) => ({
        id: `${schedule.queue}-${schedule.date}`,
        content: (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs font-semibold text-muted-foreground">
                {schedule.date === today && <span className="text-warning">Сьогодні</span>}
                {schedule.date === tomorrow && <span>Завтра</span>}
                <span>Черга {schedule.queue}</span>
              </div>
              <CardTitle className="first-letter:uppercase"><ScheduleDate value={schedule.date} /></CardTitle>
            </CardHeader>
            <CardContent>
              <ScheduleDetails schedule={schedule} showTimeline />
            </CardContent>
          </Card>
        ),
      }))} />
      <Card className="py-0">
        <details className="group" open={historyOpen}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-4 py-4 font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:px-5 [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-2"><History aria-hidden="true" className="size-4" /> Історія змін</span>
            <ChevronDown aria-hidden="true" className="size-4 text-muted-foreground group-open:rotate-180" />
          </summary>
          <CardContent className="space-y-4 border-t pt-4 pb-5">
            <Form action="/" scroll={false} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="queue" value={selectedQueue} />
              <div className="grid min-w-0 flex-1 gap-1.5 sm:max-w-56">
                <label htmlFor="history-date" className="text-sm font-medium">Дата графіка</label>
                <Input id="history-date" name="date" key={date ?? today} type="date" required defaultValue={date ?? today} />
              </div>
              <Button type="submit" variant="outline">Показати</Button>
            </Form>
            {date ? history : historyOpen && <p className="text-sm text-danger">Виберіть коректну дату графіка.</p>}
          </CardContent>
        </details>
      </Card>
    </>
  );
}
