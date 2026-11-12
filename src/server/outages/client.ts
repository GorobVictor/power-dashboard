import { createLogger, errorFields } from "../logger.ts";
import { AlertsSourceError, area, parseSchedules } from "./schedules.ts";

const siteUrl = new URL(`https://alerts.energy/${area}/schedule/kyivska-oblast-oblenergo/4.1`);
const shutdownsUrl = new URL(`/api/v1/source-registry/areas/${area}/shutdowns`, siteUrl);
const userAgent = "Mozilla/5.0 (Linux; Android 14; SM-A556B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Mobile Safari/537.36";
const timeoutMs = 10_000;
const log = createLogger("worker.outages");

export class AlertsHttpError extends AlertsSourceError {
  readonly retryAfterMs: number;

  constructor(status: number, retryAfter: string | null, now = Date.now()) {
    super(`alerts.energy returned HTTP ${status}`);
    const value = retryAfter?.trim() ?? "";
    const ms = /^\d+$/.test(value) ? Number(value) * 1_000 : Date.parse(value) - now;
    this.retryAfterMs = status === 429 && Number.isFinite(ms) ? Math.max(0, ms) : 0;
  }
}

export function parseSiteToken(html: string, now = Date.now()): string {
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!/\sid\s*=\s*(?:"site-access"|'site-access'|site-access(?=\s|$))/i.test(script[1])) continue;

    let access;
    try {
      access = JSON.parse(script[2]);
    } catch {
      throw new AlertsSourceError("Invalid site-access JSON");
    }
    if (typeof access?.token !== "string" || !/^[!-~]+$/.test(access.token) ||
        !Number.isSafeInteger(access.expiresAt) || access.expiresAt <= now) {
      throw new AlertsSourceError("Missing or expired site-access token");
    }
    return access.token;
  }
  throw new AlertsSourceError("Missing site-access script");
}

async function get(url: URL, options: RequestInit, shutdown: AbortSignal, request: typeof fetch) {
  const signal = AbortSignal.any([shutdown, AbortSignal.timeout(timeoutMs)]);
  const headers = new Headers(options.headers);
  headers.set("User-Agent", userAgent);
  const startedAt = performance.now();
  const response = await request(url, { ...options, headers, signal, cache: "no-store" }).catch((error: unknown) => {
    if (!shutdown.aborted) {
      log.warn("alerts.energy request failed before receiving a response", {
        path: url.pathname, durationMs: Math.round(performance.now() - startedAt), ...errorFields(error),
      });
    }
    throw error;
  });
  log.info("Received alerts.energy response", {
    path: url.pathname, statusCode: response.status, durationMs: Math.round(performance.now() - startedAt),
  });
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new AlertsHttpError(response.status, response.headers.get("Retry-After"));
  }
  return response;
}

export async function fetchSchedules(shutdown: AbortSignal, request = fetch) {
  const page = await get(siteUrl, { headers: { Accept: "text/html" } }, shutdown, request);
  const pageUrl = new URL(page.url || siteUrl);
  if (pageUrl.origin !== siteUrl.origin) throw new AlertsSourceError("Unexpected schedule page origin");

  const token = parseSiteToken(await page.text());
  const response = await get(shutdownsUrl, {
    redirect: "error",
    headers: { Accept: "application/json", Referer: pageUrl.href, "x-request-hash": token },
  }, shutdown, request);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) throw new AlertsSourceError("Invalid schedule JSON");
    throw error;
  }
  return parseSchedules(payload);
}
