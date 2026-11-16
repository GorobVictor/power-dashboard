import { clockTime, kyivMinute, scheduleIntervals } from "../outages/intervals.ts";
import { kyivDate, timeZone, type ScheduleVersion } from "../outages/schedules.ts";
import { escapeMarkdown } from "./markdown.ts";

type Status = "online" | "offline";
type ScheduleKind = "power" | "outage" | "possible" | "unknown";
const observedTime = new Intl.DateTimeFormat("uk-UA", { timeZone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function durationText(milliseconds: number): string {
  let seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const days = Math.floor(seconds / 86_400); seconds %= 86_400;
  const hours = Math.floor(seconds / 3_600); seconds %= 3_600;
  const minutes = Math.floor(seconds / 60); seconds %= 60;
  return [days ? `${days} дн` : "", hours ? `${hours} год` : "", minutes ? `${minutes} хв` : "", seconds || (!days && !hours && !minutes) ? `${seconds} с` : ""].filter(Boolean).join(" ");
}

export function powerMessage(status: Status, at: Date, previousStart: Date | null, schedule: string[]): string {
  const heading = status === "online" ? "⚡ *Світло зʼявилося*" : "🔌 *Світло зникло*";
  const label = status === "online" ? "Без світла" : "Зі світлом";
  const duration = previousStart && previousStart <= at ? `щонайменше ${durationText(at.getTime() - previousStart.getTime())}` : "тривалість невідома";
  const details = [`Час: ${observedTime.format(at)} · Київ`, `${label}: ${duration}`];
  return [heading, ...details.map(escapeMarkdown), ...(schedule.length ? ["", ...schedule.map(escapeMarkdown)] : [])].join("\n");
}

function nextDate(date: string) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

export function powerScheduleDetails(queue: string | undefined, at: Date, schedules: ScheduleVersion[], stale: boolean | null): string[] {
  if (!queue) return ["📅 Графік: чергу не налаштовано."];
  if (stale === true) return [`📅 Графік черги ${queue} застарів; прогноз недоступний.`];
  if (stale === null) return [`📅 Графік черги ${queue} недоступний.`];
  const today = kyivDate(at);
  const tomorrow = nextDate(today);
  const schedule = schedules.find((item) => item.date === today && item.queue === queue);
  if (!schedule || schedule.status === "WaitingForSchedule") return [`📅 Графік черги ${queue} на сьогодні недоступний.`];
  if (schedule.status === "EmergencyShutdowns" || schedule.hours.includes(9)) return [`📅 Черга ${queue}: аварійні обмеження, час зміни невідомий.`];

  const minute = kyivMinute(at.getTime());
  const intervals = scheduleIntervals(schedule);
  const current = intervals.find((item) => item.start <= minute && minute < item.end);
  const descriptions: Record<ScheduleKind, string> = {
    power: "за графіком зараз має бути світло", outage: "за графіком зараз відключення",
    possible: "зараз можливе відключення", unknown: "стан за графіком невідомий",
  };
  const kind = current?.kind ?? "unknown";
  const lines = [`📅 Черга ${queue}: ${descriptions[kind]}.`];
  if (kind === "unknown") return lines;
  const nextSchedule = schedules.find((item) => item.date === tomorrow && item.queue === queue);
  const tomorrowIntervals = nextSchedule && nextSchedule.status !== "EmergencyShutdowns" && nextSchedule.status !== "WaitingForSchedule" && !nextSchedule.hours.includes(9)
    ? scheduleIntervals(nextSchedule).map((item) => ({ ...item, start: item.start + 1_440, end: item.end + 1_440 })) : [];
  const upcoming = [...intervals.filter((item) => item.start > minute), ...tomorrowIntervals];
  const next = upcoming.find((item) => item.kind !== kind);
  if (!next || next.kind === "unknown") return lines;
  const when = `${next.start >= 1_440 ? "завтра о" : "о"} ${clockTime(next.start % 1_440)}`;
  if (kind === "possible") {
    lines.push(`Період можливого відключення за графіком триває до ${when.replace("о ", "")}.`);
    if (next.kind === "outage") lines.push(`Планове відключення ${when}.`);
  }
  else if (next.kind === "possible") lines.push(`Можливе відключення ${when}.`);
  else if (next.kind === "outage") lines.push(`Наступне відключення за графіком ${when}.`);
  else lines.push(`Поява світла за графіком ${when}.`);
  return lines;
}
