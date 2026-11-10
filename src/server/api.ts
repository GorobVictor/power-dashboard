import { getCredentials, matchesCredentials } from "./credentials.ts";
import { createLogger } from "./logger.ts";

const log = createLogger("api");

function isAuthorized(header: string | null, credentials: NonNullable<ReturnType<typeof getCredentials>>) {
  const encoded = /^Basic +([A-Za-z0-9+/]+={0,2})$/i.exec(header ?? "")?.[1];
  if (!encoded) return false;

  const decoded = Buffer.from(encoded, "base64");
  if (decoded.toString("base64") !== encoded) return false;
  const value = decoded.toString("utf8");
  if (!Buffer.from(value, "utf8").equals(decoded)) return false;

  const separator = value.indexOf(":");
  if (separator < 1) return false;
  return matchesCredentials(value.slice(0, separator), value.slice(separator + 1), credentials);
}

export function json(body: unknown, status: number, headers?: Record<string, string>) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

export function authorizeApiRequest(request: Request): Response | null {
  const authorization = request.headers.get("Authorization");
  const credentials = getCredentials();
  if (!credentials) {
    log.error("Invalid Basic Auth configuration");
    return json({ error: "service_unavailable" }, 503);
  }
  if (!isAuthorized(authorization, credentials)) {
    return json({ error: "unauthorized" }, 401, {
      "WWW-Authenticate": 'Basic realm="Power Dashboard", charset="UTF-8"',
    });
  }
  return null;
}
