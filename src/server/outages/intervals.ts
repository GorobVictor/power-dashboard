import type { ScheduleContent } from "./schedules.ts";

const queueOrder = new Intl.Collator("uk-UA", { numeric: true });

export function outageQueues(schedules: readonly { queue: string }[]) {
  return [...new Set(schedules.map(({ queue }) => queue))].sort(queueOrder.compare);
}

type Kind = "planned" | "emergency";
type Interval = { start: number; end: number; kind: Kind };
export type ScheduleInterval = { start: number; end: number; kind: "power" | "outage" | "possible" | "unknown" };

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

export function scheduleIntervals({ status, hours, possible }: Pick<ScheduleContent, "status" | "hours" | "possible">) {
  const outages = outageIntervals(hours);
  const risks = outageIntervals(possible);
  const hasPlan = status === "NoShutdowns" || (status === "ScheduleApplies" && hours.length === 24);
  const intervals: ScheduleInterval[] = [];
  for (let start = 0; start < 24 * 60; start += 30) {
    const outage = status !== "WaitingForSchedule" && outages.some((interval) => interval.start <= start && start < interval.end);
    const risk = risks.some((interval) => interval.start <= start && start < interval.end);
    const kind = outage ? "outage" : risk ? "possible" : hasPlan ? "power" : "unknown";
    const previous = intervals.at(-1);
    if (previous?.kind === kind) previous.end = start + 30;
    else intervals.push({ start, end: start + 30, kind });
  }
  return intervals;
}

export function clockTime(minutes: number) {
  const hours = Math.floor(minutes / 60).toString().padStart(2, "0");
  const remainder = (minutes % 60).toString().padStart(2, "0");
  return `${hours}:${remainder}`;
}
