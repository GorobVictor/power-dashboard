import { currentOutages } from "@/server/outages/controller";

export function GET(request: Request) {
  return currentOutages(request);
}
