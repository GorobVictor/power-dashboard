import "server-only";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { dashboardAuthConfig, isDashboardSessionValid, sessionCookieName } from "@/server/dashboard-session";

export async function dashboardSession() {
  await connection();
  const cookieStore = await cookies();
  const config = dashboardAuthConfig();
  if (!config) return "unconfigured";
  const token = cookieStore.get(sessionCookieName)?.value;
  return await isDashboardSessionValid(token, config.key) ? "authenticated" : "signed-out";
}
