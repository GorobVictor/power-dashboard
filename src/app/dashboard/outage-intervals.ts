import type { ScheduleContent } from "../../server/outages/schedules.ts";

const queueOrder = new Intl.Collator("uk-UA", { numeric: true });

export function outageQueues(schedules: readonly { queue: string }[]) {
  return [...new Set(schedules.map(({ queue }) => queue))].sort(queueOrder.compare);
}

type Kind = "planned" | "emergency";
type Interval = { start: number; end: number; kind: Kind };

export function outageIntervals(hours: ScheduleContent["hours"]): Interval[] {
  const intervals: Interval[] = [];
  for (const [hour, code] of hours.entries()) {
    if (code === 0) continue;
    const start = hour * 60 + (code === 3 ? 30 : 0);
    const end = (hour + 1) * 60 - (code === 2 ? 30 : 0);
    const kind = code === 9 ? "emergency" : "planned";
    const previous = intervals.at(-1);
    if (previous?.end === start && previous.kind === kind) {
      previous.end = end;
    } else {
      intervals.push({ start, end, kind });
    }
  }
  return intervals;
}

export function clockTime(minutes: number) {
  const hours = Math.floor(minutes / 60).toString().padStart(2, "0");
  const remainder = (minutes % 60).toString().padStart(2, "0");
  return `${hours}:${remainder}`;
}
