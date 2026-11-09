import { AlertsSourceError, area, operator, parseSchedules } from "./schedules.ts";

const siteUrl = new URL(`https://alerts.energy/${area}/schedule/${operator.id}/4.1`);
const shutdownsUrl = new URL(`/api/v1/source-registry/areas/${area}/shutdowns`, siteUrl);
const timeoutMs = 10_000;

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
  const response = await request(url, { ...options, signal, cache: "no-store" });
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
