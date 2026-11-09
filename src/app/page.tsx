import { BatteryCharging, CalendarClock, LogOut, Zap } from "lucide-react";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { isQueue, isScheduleDate } from "@/server/outages/schedules";
import { getCurrentOutages } from "@/server/outages/service";
import { signOut } from "./login/actions";
import { BatteryPanel } from "./dashboard/battery";
import { DashboardLive } from "./dashboard/live";
import { OutageHistory } from "./dashboard/outage-history";
import { outageQueues } from "./dashboard/outage-intervals";
import { OutagesPanel } from "./dashboard/outages";
import { PanelSkeleton } from "./dashboard/panel";
import { PowerFlow } from "./dashboard/power-flow";
import { RefreshButton } from "./dashboard/refresh-button";
import { dashboardSession } from "./dashboard/session";

export default function Home({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <Dashboard searchParams={searchParams} />
    </Suspense>
  );
}

function DashboardLoading() {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-8">
      <h1 className="mb-6 text-3xl font-bold tracking-tight">Power Dashboard</h1>
      <PanelSkeleton label="Перевірка сеансу" />
    </main>
  );
}

async function Dashboard({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  if (await dashboardSession() !== "authenticated") redirect("/login");

  return (
    <DashboardLive>
      <header className="border-b bg-card">
        <div className="mx-auto flex min-h-16 max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-8">
          <div className="flex items-center gap-2.5 font-semibold tracking-tight">
            <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Zap aria-hidden="true" className="size-5" />
            </span>
            Power Dashboard
          </div>
          <form action={signOut}>
            <Button variant="ghost" type="submit" className="px-2.5 sm:px-4">
              <LogOut aria-hidden="true" /> Вийти
            </Button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-8 sm:py-8">
        <div className="mb-4 flex items-center justify-between gap-2 sm:mb-6">
          <div>
            <p className="mb-1 text-xs font-semibold tracking-wider text-success uppercase">Моніторинг живлення</p>
            <h1 className="text-2xl leading-tight font-bold tracking-tight sm:text-4xl">Огляд енергії</h1>
          </div>
          <RefreshButton />
        </div>
        <div className="mb-6 sm:mb-8">
          <PowerFlow />
        </div>
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.12fr)]">
          <section aria-labelledby="battery-heading" className="min-w-0 space-y-4">
            <h2 id="battery-heading" className="flex items-center gap-2.5 text-xl font-semibold tracking-tight">
              <BatteryCharging aria-hidden="true" className="size-5 text-success" /> Акумулятор
            </h2>
            <BatteryPanel />
          </section>
          <section aria-labelledby="outages-heading" className="min-w-0 space-y-4">
            <h2 id="outages-heading" className="flex items-center gap-2.5 text-xl font-semibold tracking-tight">
              <CalendarClock aria-hidden="true" className="size-5 text-warning" /> Відключення
            </h2>
            <Suspense fallback={<PanelSkeleton label="Завантаження графіків відключень" />}>
              <DashboardOutages searchParams={searchParams} />
            </Suspense>
          </section>
        </div>
      </main>
    </DashboardLive>
  );
}

async function DashboardOutages({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const params = await searchParams;
  const date = isScheduleDate(params.date) ? params.date : null;
  const queue = params.queue === "all" ? null : isQueue(params.queue) ? params.queue : undefined;
  if (!date) return <OutagesPanel date={null} requestedQueue={queue} historyOpen={params.date !== undefined} history={null} />;

  const current = queue === undefined ? await getCurrentOutages(null).catch(() => null) : null;
  const historyQueue = queue === undefined ? outageQueues(current?.schedules ?? [])[0] ?? null : queue;
  return (
    <OutagesPanel date={date} requestedQueue={historyQueue} historyOpen history={(
      <Suspense key={`${historyQueue}-${date}`} fallback={<PanelSkeleton label="Завантаження історії графіків" />}>
        <OutageHistory date={date} queue={historyQueue} />
      </Suspense>
    )} />
  );
}
