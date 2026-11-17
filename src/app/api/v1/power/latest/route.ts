import { powerController } from "@/server/power/controller";

export function GET(request: Request) {
  return powerController(request);
}
