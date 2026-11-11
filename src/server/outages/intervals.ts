import { timeZone, type ScheduleContent } from "./schedules.ts";

const queueOrder = new Intl.Collator("uk-UA", { numeric: true });
const kyivTime = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export const minutesPerDay = 24 * 60;

export function kyivMinute(time: number) {
  const [hour, minute] = kyivTime.format(time).split(":").map(Number);
  return hour * 60 + minute;
}

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
  for (let start = 0; start < minutesPerDay; start += 30) {
    const outage = status !== "WaitingForSchedule" && outages.some((interval) => interval.start <= start && start < interval.end);
    const risk = risks.some((interval) => interval.start <= start && start < interval.end);
    const kind = outage ? "outage" : risk ? "possible" : hasPlan ? "power" : "unknown";
    const previous = intervals.at(-1);
    if (previous?.kind === kind) previous.end = start + 30;
    else intervals.push({ start, end: start + 30, kind });
  }
  return intervals;
}

export function scheduleBands(intervals: ScheduleInterval[], day: { start: number; end: number }) {
  const duration = (day.end - day.start) / 60_000;
  if (duration === minutesPerDay) return intervals;

  // The schedule uses Kyiv clock hours, while measurements use elapsed time.
  const bands: ScheduleInterval[] = [];
  for (let start = 0; start < duration; start += 30) {
    const minute = kyivMinute(day.start + start * 60_000);
    const kind = intervals.find((interval) => interval.start <= minute && minute < interval.end)?.kind ?? "unknown";
    const previous = bands.at(-1);
    if (previous?.kind === kind) previous.end = start + 30;
    else bands.push({ start, end: start + 30, kind });
  }
  return bands;
}

export function clockTime(minutes: number) {
  const hours = Math.floor(minutes / 60).toString().padStart(2, "0");
  const remainder = (minutes % 60).toString().padStart(2, "0");
  return `${hours}:${remainder}`;
}
