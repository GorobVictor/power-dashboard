import { createHmac } from "node:crypto";
import { sealData, unsealData } from "iron-session";
import { getCredentials } from "./credentials.ts";

export const sessionCookieName = "power_dashboard_session";
export const refreshCookieName = "power_dashboard_refresh";
const sessionLifetimeSeconds = 8 * 60 * 60;
const refreshLifetimeSeconds = 5 * 24 * 60 * 60;

export function dashboardAuthConfig() {
  const credentials = getCredentials();
  const secret = process.env.DASHBOARD_SESSION_SECRET;
  if (!credentials || !secret || secret.length < 32) return null;

  const key = createHmac("sha256", secret)
    .update(JSON.stringify([credentials.username, credentials.password]))
    .digest("hex");
  return { credentials, key };
}

export function sessionCookieOptions(maxAge = sessionLifetimeSeconds) {
  const secureSetting = process.env.DASHBOARD_SECURE_COOKIE;
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: secureSetting === "true" || (secureSetting !== "false" && process.env.NODE_ENV === "production"),
    path: "/",
    maxAge,
  };
}

export function createDashboardSession(key: string, now = Date.now()) {
  return sealData({ type: "access", expiresAt: now + sessionLifetimeSeconds * 1_000 }, { password: key, ttl: sessionLifetimeSeconds });
}

export function createDashboardRefresh(key: string, now = Date.now()) {
  return sealData({ type: "refresh", expiresAt: now + refreshLifetimeSeconds * 1_000 }, { password: key, ttl: refreshLifetimeSeconds });
}

export function refreshCookieOptions() {
  return sessionCookieOptions(refreshLifetimeSeconds);
}

export async function dashboardSessionExpiration(token: string | undefined, key: string, now?: number) {
  if (!token) return null;
  try {
    const { expiresAt, type } = await unsealData<{ expiresAt?: number; type?: string }>(token, {
      password: key,
      ttl: sessionLifetimeSeconds,
    });
    return (type === "access" || type === undefined) && typeof expiresAt === "number" && Number.isFinite(expiresAt) && expiresAt > (now ?? Date.now()) ? expiresAt : null;
  } catch {
    return null;
  }
}

export async function isDashboardRefreshValid(token: string | undefined, key: string, now = Date.now()) {
  if (!token) return false;
  try {
    const { type, expiresAt } = await unsealData<{ type?: string; expiresAt?: number }>(token, { password: key, ttl: refreshLifetimeSeconds });
    return type === "refresh" && typeof expiresAt === "number" && Number.isFinite(expiresAt) && expiresAt > now;
  } catch {
    return false;
  }
}

export async function isDashboardSessionValid(token: string | undefined, key: string, now?: number) {
  return (await dashboardSessionExpiration(token, key, now)) !== null;
}

export async function isLegacyDashboardSession(token: string | undefined, key: string) {
  if (!token || !await isDashboardSessionValid(token, key)) return false;
  try {
    const data = await unsealData<{ type?: string }>(token, { password: key, ttl: sessionLifetimeSeconds });
    return data.type === undefined;
  } catch {
    return false;
  }
}
