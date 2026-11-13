import { NextResponse, type NextRequest } from "next/server";
import { createDashboardRefresh, createDashboardSession, dashboardAuthConfig, isDashboardRefreshValid, isLegacyDashboardSession, refreshCookieName, refreshCookieOptions, sessionCookieName, sessionCookieOptions } from "@/server/dashboard-session";

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !URL.canParse(origin) || !["http:", "https:"].includes(new URL(origin).protocol) || new URL(origin).host !== host?.toLowerCase()) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const config = dashboardAuthConfig();
  const refresh = request.cookies.get(refreshCookieName)?.value;
  if (!config) return NextResponse.json({ error: "service_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  if (!refresh && await isLegacyDashboardSession(request.cookies.get(sessionCookieName)?.value, config.key)) {
    return NextResponse.json({ legacy: true }, { headers: { "Cache-Control": "no-store" } });
  }
  if (!await isDashboardRefreshValid(refresh, config.key)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const [access, renewedRefresh] = await Promise.all([createDashboardSession(config.key), createDashboardRefresh(config.key)]);
  const response = NextResponse.json({ legacy: false }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(sessionCookieName, access, sessionCookieOptions());
  response.cookies.set(refreshCookieName, renewedRefresh, refreshCookieOptions());
  return response;
}
