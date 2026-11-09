import { authorizeApiRequest, json } from "../api.ts";
import { database } from "../db.ts";
import { findCurrentSchedules, findScheduleHistory } from "./repository.ts";
import { area, isQueue, isScheduleDate, kyivDate, operator, timeZone } from "./schedules.ts";

const source = { area, operator, timeZone };
const staleAfterMs = 180_000;

function queueFilter(params: URLSearchParams) {
  const queue = params.get("queue");
  if (params.getAll("queue").length > 1 || (queue !== null && !isQueue(queue))) return undefined;
  return queue;
}

const readCurrent = (from: string, queue: string | null) => findCurrentSchedules(database(), from, queue);
const readHistory = (date: string, queue: string | null) => findScheduleHistory(database(), date, queue);

export async function currentOutages(request: Request, read = readCurrent, now = new Date()) {
  const unauthorized = authorizeApiRequest(request);
  if (unauthorized) return unauthorized;
  const params = new URL(request.url).searchParams;
  const queue = queueFilter(params);
  if (queue === undefined || [...params.keys()].some((key) => key !== "queue")) {
    return json({ error: "invalid_parameters" }, 400);
  }

  try {
    const current = await read(kyivDate(now), queue);
    const lastPoll = current.lastSuccessfulPollAt;
    return json({
      ...source,
      ...current,
      stale: lastPoll ? now.getTime() - lastPoll.getTime() >= staleAfterMs : null,
    }, 200);
  } catch (error) {
    console.error("Unable to read current outage schedules", (error as Error).name);
    return json({ error: "service_unavailable" }, 503);
  }
}

export async function outageHistory(request: Request, read = readHistory) {
  const unauthorized = authorizeApiRequest(request);
  if (unauthorized) return unauthorized;
  const params = new URL(request.url).searchParams;
  const date = params.get("date");
  const queue = queueFilter(params);
  if (!isScheduleDate(date) || params.getAll("date").length > 1 || queue === undefined ||
      [...params.keys()].some((key) => key !== "date" && key !== "queue")) {
    return json({ error: "invalid_parameters" }, 400);
  }

  try {
    const versions = await read(date, queue);
    return json({ ...source, date, versions }, 200);
  } catch (error) {
    console.error("Unable to read outage schedule history", (error as Error).name);
    return json({ error: "service_unavailable" }, 503);
  }
}
