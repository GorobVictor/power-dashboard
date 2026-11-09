import { database } from "../db.ts";
import { findCurrentSchedules, findScheduleHistory } from "./repository.ts";
import { area, kyivDate, operator, timeZone } from "./schedules.ts";

export const outageSource = { area, operator, timeZone };
export const outageStaleAfterMs = 180_000;

const readCurrent = (from: string, queue: string | null) => findCurrentSchedules(database(), from, queue);

export async function getCurrentOutages(queue: string | null, now = new Date(), read = readCurrent) {
  const current = await read(kyivDate(now), queue);
  const lastPoll = current.lastSuccessfulPollAt;
  return {
    ...outageSource,
    ...current,
    stale: lastPoll ? now.getTime() - lastPoll.getTime() >= outageStaleAfterMs : null,
  };
}

export function getOutageHistory(date: string, queue: string | null) {
  return findScheduleHistory(database(), date, queue);
}
