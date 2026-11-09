import { ChevronDown, History } from "lucide-react";
import Form from "next/form";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, inputClassName } from "@/components/ui/input";
import { isQueue, isScheduleDate, kyivDate, operator, timeZone, type ScheduleContent } from "@/server/outages/schedules";
import { getCurrentOutages, getOutageHistory } from "@/server/outages/service";
import { clockTime, outageIntervals } from "./outage-intervals";
import { PanelSkeleton, StatusBadge, Timestamp } from "./panel";

const dateFormat = new Intl.DateTimeFormat("uk-UA", {
  timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric",
});
const queueOrder = new Intl.Collator("uk-UA", { numeric: true });
const statuses = {
  ScheduleApplies: { label: "Діє графік", tone: "warning" },
  WaitingForSchedule: { label: "Очікується графік", tone: "muted" },
  NoShutdowns: { label: "Без відключень", tone: "success" },
  EmergencyShutdowns: { label: "Аварійні обмеження", tone: "danger" },
} as const;

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

function ScheduleDetails({ schedule }: { schedule: ScheduleContent }) {
  return (
    <div className="space-y-4">
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

async function HistoryResults({ date, queue }: { date: string; queue: string | null }) {
  let versions: Awaited<ReturnType<typeof getOutageHistory>>;
  try {
    versions = await getOutageHistory(date, queue);
  } catch (error) {
    console.error("Unable to load dashboard outage history", (error as Error).name);
    return <p className="text-sm text-danger">Історія тимчасово недоступна. Спробуйте оновити дашборд.</p>;
  }

  if (!versions.length) return <p className="text-sm text-muted-foreground">За вибрану дату немає збережених версій.</p>;

  return (
    <ol className="space-y-2.5" aria-label="Збережені версії графіка">
      {versions.map((version, index) => (
        <li key={`${version.queue}-${version.observedAt.toISOString()}-${index}`} className="space-y-3 rounded-lg border p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-1.5">
            <p className="text-sm font-medium">Версія {index + 1} · Черга {version.queue}</p>
            <p className="text-xs text-muted-foreground"><Timestamp value={version.observedAt} /></p>
          </div>
          <ScheduleDetails schedule={version} />
        </li>
      ))}
    </ol>
  );
}

export async function OutagesPanel({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const params = await searchParams;
  const now = new Date();
  const today = kyivDate(now);
  const date = isScheduleDate(params.date) ? params.date : null;

  let current: Awaited<ReturnType<typeof getCurrentOutages>> | null = null;
  try {
    current = await getCurrentOutages(null, now);
  } catch (error) {
    console.error("Unable to load dashboard outage schedules", (error as Error).name);
  }

  const queues = [...new Set(current?.schedules.map(({ queue }) => queue))].sort(queueOrder.compare);
  const queue = params.queue === "all" ? null : isQueue(params.queue) ? params.queue : queues[0] ?? null;
  if (queue && !queues.includes(queue)) queues.push(queue);
  const selectedQueue = queue ?? "all";
  const schedules = current?.schedules.filter((schedule) => queue === null || schedule.queue === queue) ?? [];

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-lg">Актуальний графік</CardTitle>
            {current?.stale === true && <StatusBadge tone="warning">Застарілий графік</StatusBadge>}
            {current?.stale === false && <StatusBadge tone="success">Джерело оновлено</StatusBadge>}
            {current?.stale === null && <StatusBadge tone="muted">Очікуємо дані</StatusBadge>}
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
      {schedules.map((schedule) => (
        <Card key={`${schedule.queue}-${schedule.date}`}>
          <CardHeader>
            <CardTitle className="first-letter:uppercase"><ScheduleDate value={schedule.date} /></CardTitle>
            <CardDescription>Черга {schedule.queue}</CardDescription>
          </CardHeader>
          <CardContent>
            <ScheduleDetails schedule={schedule} />
          </CardContent>
        </Card>
      ))}
      <Card className="py-0">
        <details className="group" open={params.date !== undefined}>
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
            {date ? (
              <Suspense key={`${selectedQueue}-${date}`} fallback={<PanelSkeleton label="Завантаження історії графіків" />}>
                <HistoryResults date={date} queue={queue} />
              </Suspense>
            ) : params.date !== undefined && <p className="text-sm text-danger">Виберіть коректну дату графіка.</p>}
          </CardContent>
        </details>
      </Card>
    </>
  );
}
