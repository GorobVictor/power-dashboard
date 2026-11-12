import { LogOut, Zap } from "lucide-react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { ConnectionStatus } from "./dashboard/connection-status";
import { DashboardDeck } from "./dashboard/dashboard-deck";
import { DashboardLive } from "./dashboard/live";
import { ThemeSwitcher } from "./dashboard/theme-switcher";
import { PanelSkeleton } from "./dashboard/panel";
import { dashboardSession } from "./dashboard/session";
import { signOut } from "./login/actions";

export default function Home() {
  return (
    <Suspense fallback={
      <main className="mx-auto w-full max-w-7xl px-3.5 py-4 sm:px-6">
        <PanelSkeleton label="Перевірка сеансу" />
      </main>
    }>
      <Dashboard />
    </Suspense>
  );
}

async function Dashboard() {
  const mock = process.env.NODE_ENV === "development" && process.env.DASHBOARD_MOCK === "1";
  if (mock) await connection();
  else if (await dashboardSession() !== "authenticated") redirect("/login");

  return (
    <DashboardLive mock={mock}>
      <div className="max-lg:flex max-lg:min-h-dvh max-lg:flex-col">
        <header className="relative z-30 border-b bg-card pt-[env(safe-area-inset-top)]">
          <div className="mx-auto flex min-h-14 max-w-7xl items-center justify-between gap-2 px-4 py-2 sm:px-6">
            <div className="flex min-w-0 items-center gap-2 text-sm font-semibold tracking-tight sm:text-base">
              <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
                <Zap aria-hidden="true" className="size-[18px]" />
              </span>
              <span className="truncate">Power Dashboard</span>
            </div>
            <div className="flex items-center gap-1 sm:gap-3">
              <ConnectionStatus mock={mock} />
              <ThemeSwitcher />
              {!mock && <form action={signOut}>
                <Button variant="ghost" type="submit" aria-label="Вийти" className="size-9 px-0 sm:w-auto sm:px-3">
                  <LogOut aria-hidden="true" /> <span className="hidden sm:inline">Вийти</span>
                </Button>
              </form>}
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-4 max-lg:flex max-lg:grow max-lg:flex-col sm:px-6 sm:py-4">
          <Suspense fallback={<PanelSkeleton label="Завантаження карток дашборда" />}>
            <DashboardDeck />
          </Suspense>
        </main>
      </div>
    </DashboardLive>
  );
}
