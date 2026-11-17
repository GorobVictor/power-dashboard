import { authorizeApiRequest, json } from "../api.ts";
import { createLogger, errorFields } from "../logger.ts";
import { getPowerStatus } from "./service.ts";

const log = createLogger("api.power");

export async function powerController(request: Request, read = getPowerStatus) {
  const unauthorized = authorizeApiRequest(request);
  if (unauthorized) return unauthorized;
  try {
    return json({ power: await read() }, 200);
  } catch (error) {
    log.error("Unable to read power monitor", errorFields(error));
    return json({ error: "service_unavailable" }, 503);
  }
}
