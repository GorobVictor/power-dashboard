import { outageOverview } from "@/server/outages/controller";

export async function GET(request: Request) {
  return outageOverview(request);
}
