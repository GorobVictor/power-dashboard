import { outageHistory } from "@/server/outages/controller";

export function GET(request: Request) {
  return outageHistory(request);
}
