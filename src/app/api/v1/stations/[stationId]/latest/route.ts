import { latestController } from "@/server/stations/controller";
import { getLatestMeasurement } from "@/server/stations/service";

export async function GET(
  request: Request,
  context: RouteContext<"/api/v1/stations/[stationId]/latest">,
) {
  const { stationId } = await context.params;
  return latestController(request, stationId, getLatestMeasurement);
}
