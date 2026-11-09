import { createHmac } from "node:crypto";
import { sealData, unsealData } from "iron-session";
import { getCredentials } from "./credentials.ts";

export const sessionCookieName = "power_dashboard_session";
const sessionLifetimeSeconds = 8 * 60 * 60;

export function dashboardAuthConfig() {
  const credentials = getCredentials();
  const secret = process.env.DASHBOARD_SESSION_SECRET;
  if (!credentials || !secret || secret.length < 32) return null;

  const key = createHmac("sha256", secret)
    .update(JSON.stringify([credentials.username, credentials.password]))
    .digest("hex");
  return { credentials, key };
}

export function sessionCookieOptions() {
  const secureSetting = process.env.DASHBOARD_SECURE_COOKIE;
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: secureSetting === "true" || (secureSetting !== "false" && process.env.NODE_ENV === "production"),
    path: "/",
    maxAge: sessionLifetimeSeconds,
  };
}

export function createDashboardSession(key: string, now = Date.now()) {
  return sealData({ expiresAt: now + sessionLifetimeSeconds * 1_000 }, { password: key, ttl: sessionLifetimeSeconds });
}

export async function isDashboardSessionValid(token: string | undefined, key: string, now?: number) {
  if (!token) return false;
  try {
    const { expiresAt } = await unsealData<{ expiresAt?: number }>(token, {
      password: key,
      ttl: sessionLifetimeSeconds,
    });
    return typeof expiresAt === "number" && Number.isFinite(expiresAt) && expiresAt > (now ?? Date.now());
  } catch {
    return false;
  }
}
