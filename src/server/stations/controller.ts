import { authorizeApiRequest, json } from "../api.ts";
import type { getLatestMeasurement } from "./service.ts";

export async function latestController(
  request: Request,
  stationId: string,
  getLatest: typeof getLatestMeasurement,
): Promise<Response> {
  const unauthorized = authorizeApiRequest(request);
  if (unauthorized) return unauthorized;
  try {
    const latest = await getLatest(stationId);
    return latest ? json(latest, 200) : json({ error: "station_not_found" }, 404);
  } catch (error) {
    console.error("Unable to read latest measurement", (error as Error).name);
    return json({ error: "service_unavailable" }, 503);
  }
}
