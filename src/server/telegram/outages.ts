import type { Client } from "pg";
import { inTransaction } from "../db.ts";
import { findCurrentSchedules, saveOutagePoll } from "../outages/repository.ts";
import { kyivDate, timeZone, type Schedule, type ScheduleContent } from "../outages/schedules.ts";
import { getCurrentOutages } from "../outages/service.ts";
import { escapeMarkdown } from "./markdown.ts";
import { enqueueTelegramMessages } from "./outbox.ts";

const MINUTES_PER_DAY = 24 * 60;
const kyivTime = new Intl.DateTimeFormat("en-GB", {
  timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

function coversTime(code: ScheduleContent["hours"][number] | undefined, minute: number) {
  return code === 1 || (code === 2 && minute < 30) || (code === 3 && minute >= 30);
}

export async function describeOutageAt(db: Client, queue: string, at: Date) {
  const outages = await getCurrentOutages(queue, at, (date, selectedQueue) =>
    findCurrentSchedules(db, date, selectedQueue));
  if (outages.stale) return `Графік черги ${queue} застарів.`;
  const schedule = outages.schedules.find(({ date }) => date === kyivDate(at));
  if (!schedule || schedule.status === "WaitingForSchedule") {
    return `Графік черги ${queue} на поточний час недоступний.`;
  }
  const [hour, minute] = kyivTime.format(at).split(":").map(Number);
  const planned = schedule.hours[hour];
  const possible = schedule.possible[hour];
  if (schedule.status === "EmergencyShutdowns" || planned === 9) {
    return `ДТЕК повідомляє про аварійні обмеження для черги ${queue}.`;
  }
  if (coversTime(planned, minute)) return `За графіком черги ${queue} зараз відключення.`;
  if (possible === 9 || coversTime(possible, minute)) {
    return `За графіком черги ${queue} зараз можливе відключення.`;
  }
  if (planned !== undefined || schedule.status === "NoShutdowns") {
    return `За графіком черги ${queue} зараз має бути світло.`;
  }
  return `Графік черги ${queue} на поточний час недоступний.`;
}

function isPublished(content: ScheduleContent | null) {
  return content !== null && (content.status !== "WaitingForSchedule" ||
    content.hours.length > 0 || content.possible.length > 0 || content.publishedSchedule !== null);
}

function outageMinutes(content: ScheduleContent | null) {
  if (!content || content.hours.includes(9)) return null;
  if (content.status === "NoShutdowns") return 0;
  if (content.status !== "ScheduleApplies" || content.hours.length !== 24) return null;
  return content.hours.reduce((total, code) => total + 30 *
    (Number(coversTime(code, 0)) + Number(coversTime(code, 30))), 0);
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (remainder === 0) return `${hours} год`;
  if (hours === 0) return `${remainder} хв`;
  return `${hours} год ${remainder} хв`;
}

function scheduleMessage(
  { date, queue, content }: Schedule, previousContent: ScheduleContent | null, wasPublished: boolean,
) {
  const event = wasPublished ? "Оновився графік ДТЕК" : "З’явився графік ДТЕК";
  const dateLabel = escapeMarkdown(date.split("-").reverse().join("."));
  const lines = [`📅 *${event}*`, `Черга *${escapeMarkdown(queue)}* · ${dateLabel} · Київська область`, ""];

  const minutesOff = outageMinutes(content);
  if (minutesOff === null) {
    lines.push("Тривалість відключень за добу поки невідома");
  } else {
    lines.push(
      `💡 Зі світлом за графіком: *${formatDuration(MINUTES_PER_DAY - minutesOff)}*`,
      `🌑 Без світла за графіком: *${formatDuration(minutesOff)}*`,
    );
  }

  if (wasPublished) {
    const previousMinutesOff = outageMinutes(previousContent);
    if (minutesOff === null || previousMinutesOff === null) {
      lines.push("", "Порівняння з попереднім графіком недоступне");
    } else {
      const difference = previousMinutesOff - minutesOff;
      if (difference === 0) {
        lines.push("", "↔️ Загальний час зі світлом не змінився");
      } else {
        const duration = formatDuration(Math.abs(difference));
        lines.push("", difference > 0 ? `📈 Світла на *${duration} більше*` : `📉 Світла на *${duration} менше*`);
      }
    }
  }
  return lines.join("\n");
}

export async function saveOutagePollWithTelegram(
  db: Client, schedules: Schedule[], observedAt: Date, selectedQueue: string,
) {
  await inTransaction(db, async () => {
    const changes = await saveOutagePoll(db, schedules, observedAt);
    const today = kyivDate(observedAt);
    const messages: string[] = [];
    for (const change of changes) {
      const { date, queue, content, previousContent } = change;
      if (queue !== selectedQueue || date < today) continue;
      const wasPublished = isPublished(previousContent);
      if (!wasPublished && !isPublished(content)) continue;
      messages.push(scheduleMessage(change, previousContent, wasPublished));
    }
    await enqueueTelegramMessages(db, messages);
  });
}
