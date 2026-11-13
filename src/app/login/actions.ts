"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { matchesDashboardCredentials } from "@/server/credentials";
import {
  createDashboardSession,
  createDashboardRefresh,
  dashboardAuthConfig,
  refreshCookieName,
  refreshCookieOptions,
  sessionCookieName,
  sessionCookieOptions,
} from "@/server/dashboard-session";

export async function signIn(_previous: string | null, form: FormData) {
  const config = dashboardAuthConfig();
  if (!config) return "Вхід тимчасово недоступний.";

  const username = form.get("username");
  const password = form.get("password");
  if (typeof username !== "string" || typeof password !== "string" ||
      !matchesDashboardCredentials(username, password, config.credentials)) {
    return "Неправильний логін або пароль.";
  }

  const cookieStore = await cookies();
  cookieStore.set(sessionCookieName, await createDashboardSession(config.key), sessionCookieOptions());
  cookieStore.set(refreshCookieName, await createDashboardRefresh(config.key), refreshCookieOptions());
  redirect("/");
}

export async function signOut() {
  const cookieStore = await cookies();
  cookieStore.set(sessionCookieName, "", { ...sessionCookieOptions(), maxAge: 0 });
  cookieStore.set(refreshCookieName, "", { ...refreshCookieOptions(), maxAge: 0 });
  redirect("/login");
}
