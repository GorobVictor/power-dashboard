import { createHash, timingSafeEqual } from "node:crypto";
import type { getLatestMeasurement } from "./service.ts";

function sameSecret(actual: string, expected: string) {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(actual), digest(expected));
}

function isAuthorized(header: string | null, username: string, password: string) {
  const encoded = /^Basic +([A-Za-z0-9+/]+={0,2})$/i.exec(header ?? "")?.[1];
  if (!encoded) return false;

  const decoded = Buffer.from(encoded, "base64");
  if (decoded.toString("base64") !== encoded) return false;
  const credentials = decoded.toString("utf8");
  if (!Buffer.from(credentials, "utf8").equals(decoded)) return false;

  const separator = credentials.indexOf(":");
  if (separator < 1) return false;
  const validUsername = sameSecret(credentials.slice(0, separator), username);
  const validPassword = sameSecret(credentials.slice(separator + 1), password);
  return validUsername && validPassword;
}

function json(body: unknown, status: number, headers?: Record<string, string>) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

export async function latestController(
  request: Request,
  stationId: string,
  getLatest: typeof getLatestMeasurement,
): Promise<Response> {
  const { API_USERNAME: username, API_PASSWORD: password } = process.env;
  if (!username || username.includes(":") || !password) {
    console.error("Invalid Basic Auth configuration");
    return json({ error: "service_unavailable" }, 503);
  }
  if (!isAuthorized(request.headers.get("Authorization"), username, password)) {
    return json({ error: "unauthorized" }, 401, {
      "WWW-Authenticate": 'Basic realm="Power Dashboard", charset="UTF-8"',
    });
  }
  try {
    const latest = await getLatest(stationId);
    return latest ? json(latest, 200) : json({ error: "station_not_found" }, 404);
  } catch (error) {
    console.error("Unable to read latest measurement", (error as Error).name);
    return json({ error: "service_unavailable" }, 503);
  }
}
