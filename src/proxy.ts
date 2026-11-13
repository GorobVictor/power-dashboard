import { NextResponse, type NextRequest } from "next/server";
import { createDashboardRefresh, createDashboardSession, dashboardAuthConfig, isDashboardRefreshValid, refreshCookieName, refreshCookieOptions, sessionCookieName, sessionCookieOptions } from "@/server/dashboard-session";

export async function proxy(request: NextRequest) {
  if (request.method !== "GET" || (process.env.NODE_ENV === "development" && process.env.DASHBOARD_MOCK === "1")) return NextResponse.next();
  const refresh = request.cookies.get(refreshCookieName)?.value;
  if (!refresh) return NextResponse.next(); // Existing sessions continue until their access token expires.
  const config = dashboardAuthConfig();
  if (!config || !await isDashboardRefreshValid(refresh, config.key)) {
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.set(sessionCookieName, "", { ...sessionCookieOptions(), maxAge: 0 });
    response.cookies.set(refreshCookieName, "", { ...refreshCookieOptions(), maxAge: 0 });
    return response;
  }
  const [access, renewedRefresh] = await Promise.all([createDashboardSession(config.key), createDashboardRefresh(config.key)]);
  request.cookies.set(sessionCookieName, access);
  const headers = new Headers(request.headers);
  headers.set("cookie", request.cookies.toString());
  const response = NextResponse.next({ request: { headers } });
  response.cookies.set(sessionCookieName, access, sessionCookieOptions());
  response.cookies.set(refreshCookieName, renewedRefresh, refreshCookieOptions());
  return response;
}

export const config = { matcher: "/" };
