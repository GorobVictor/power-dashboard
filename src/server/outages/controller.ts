import { authorizeApiRequest, json } from "../api.ts";
import { createLogger, errorFields } from "../logger.ts";
import { getOutageOverview } from "./overview.ts";
import { isQueue, isScheduleDate } from "./schedules.ts";
import { getCurrentOutages, getOutageHistory, outageSource } from "./service.ts";

const log = createLogger("api.outages");

function queueFilter(params: URLSearchParams) {
  const queue = params.get("queue");
  if (params.getAll("queue").length > 1 || (queue !== null && !isQueue(queue))) return undefined;
  return queue;
}

export async function currentOutages(request: Request, read?: Parameters<typeof getCurrentOutages>[2], now = new Date()) {
  const unauthorized = authorizeApiRequest(request);
  if (unauthorized) return unauthorized;
  const params = new URL(request.url).searchParams;
  const queue = queueFilter(params);
  if (queue === undefined || [...params.keys()].some((key) => key !== "queue")) {
    return json({ error: "invalid_parameters" }, 400);
  }

  try {
    return json(await getCurrentOutages(queue, now, read), 200);
  } catch (error) {
    log.error("Unable to read current outage schedules", { queue, ...errorFields(error) });
    return json({ error: "service_unavailable" }, 503);
  }
}

export async function outageOverview(request: Request, read = getOutageOverview, now = new Date()) {
  const unauthorized = authorizeApiRequest(request);
  if (unauthorized) return unauthorized;
  const params = new URL(request.url).searchParams;
  const queue = queueFilter(params);
  if (!queue || [...params.keys()].some((key) => key !== "queue")) {
    return json({ error: "invalid_parameters" }, 400);
  }

  try {
    return json(await read(queue, now), 200);
  } catch (error) {
    log.error("Unable to read outage overview", { queue, ...errorFields(error) });
    return json({ error: "service_unavailable" }, 503);
  }
}

export async function outageHistory(request: Request, read = getOutageHistory) {
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
    return json({ ...outageSource, date, versions }, 200);
  } catch (error) {
    log.error("Unable to read outage schedule history", { date, queue, ...errorFields(error) });
    return json({ error: "service_unavailable" }, 503);
  }
}
