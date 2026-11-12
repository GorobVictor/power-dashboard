import { clockTime, outageIntervals } from "../../server/outages/intervals.ts";
import type { ScheduleContent } from "../../server/outages/schedules.ts";

function ranges(content: ScheduleContent, key: "hours" | "possible") {
  return outageIntervals(content[key]).map(({ start, end, kind }) =>
    `${clockTime(start)}–${clockTime(end)}${kind === "emergency" ? " (аварійні)" : ""}`);
}

export function compareSchedules(previous: ScheduleContent, current: ScheduleContent) {
  const changes: string[] = [];
  if (previous.status !== current.status) changes.push(`Статус: ${statusLabel(previous.status)} → ${statusLabel(current.status)}`);
  for (const [key, label] of [["hours", "Планові"], ["possible", "Можливі"]] as const) {
    const before = ranges(previous, key);
    const after = ranges(current, key);
    const removed = before.filter((item) => !after.includes(item));
    const added = after.filter((item) => !before.includes(item));
    if (removed.length || added.length) changes.push(`${label}: було ${removed.join(", ") || "—"}; стало ${added.join(", ") || "—"}`);
  }
  const complete = (value: ScheduleContent) => (value.status === "NoShutdowns" || (value.status === "ScheduleApplies" && value.hours.length === 24)) && !value.hours.includes(9);
  if (complete(previous) && complete(current)) {
    const total = (value: ScheduleContent) => value.status === "NoShutdowns" ? 0 : outageIntervals(value.hours).reduce((sum, item) => sum + item.end - item.start, 0);
    const diff = total(current) - total(previous);
    if (diff) changes.unshift(`Планових відключень ${diff > 0 ? "більше" : "менше"} на ${Math.floor(Math.abs(diff) / 60)} год ${Math.abs(diff) % 60} хв`);
  }
  return changes;
}

function statusLabel(status: ScheduleContent["status"]) {
  return ({ ScheduleApplies: "Діє графік", WaitingForSchedule: "Очікується графік", NoShutdowns: "Без відключень", EmergencyShutdowns: "Аварійні обмеження" })[status];
}
