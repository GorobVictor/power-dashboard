import type { Client } from "pg";
import { inTransaction } from "../db.ts";
import { findCurrentSchedules, saveOutagePoll } from "../outages/repository.ts";
import { kyivDate, timeZone, type Schedule, type ScheduleContent } from "../outages/schedules.ts";
import { getCurrentOutages } from "../outages/service.ts";
import { enqueueTelegramMessages } from "./outbox.ts";

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

export async function saveOutagePollWithTelegram(
  db: Client, schedules: Schedule[], observedAt: Date, selectedQueue: string,
) {
  await inTransaction(db, async () => {
    const changes = await saveOutagePoll(db, schedules, observedAt);
    const today = kyivDate(observedAt);
    const messages: string[] = [];
    for (const { date, queue, content, previousContent } of changes) {
      if (queue !== selectedQueue || date < today) continue;
      const wasPublished = isPublished(previousContent);
      if (!wasPublished && !isPublished(content)) continue;
      const dateLabel = date.split("-").reverse().join(".");
      const event = wasPublished ? "Оновився графік" : "З’явився графік";
      messages.push(`ДТЕК · Київська область · ${dateLabel}\n${event} для черги ${queue}.`);
    }
    await enqueueTelegramMessages(db, messages);
  });
}
