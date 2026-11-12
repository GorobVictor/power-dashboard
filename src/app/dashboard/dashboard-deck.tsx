"use client";

import { Activity, CalendarClock, Zap } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { BatteryPanel } from "./battery";
import { OutageHistoryPanel, OutagesPanel, useOutageQueue } from "./outages";
import { PowerFlow } from "./power-flow";
import { TelemetryPanel } from "./telemetry";

const panels = [
  { id: "overview", controls: "energy-overview", label: "Огляд", icon: Zap },
  { id: "schedule", controls: "outage-schedule", label: "Графік", icon: CalendarClock },
  { id: "telemetry", controls: "station-telemetry", label: "Виміри", icon: Activity },
] as const;

const panelFrame = "min-w-0 lg:grid";
const panelStorageKey = "power-dashboard.active-panel";
type Panel = typeof panels[number]["id"] | "archive";

function readSavedPanel() {
  try {
    const saved = window.localStorage.getItem(panelStorageKey);
    return saved === "archive" ? "archive" : panels.find(({ id }) => id === saved)?.id ?? null;
  } catch {
    return null;
  }
}

function subscribeToSavedPanel(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function subscribeToMobile(onChange: () => void) {
  const query = window.matchMedia("(min-width: 64rem)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function isMobile() {
  return !window.matchMedia("(min-width: 64rem)").matches;
}

export function DashboardDeck() {
  const params = useSearchParams();
  const [dateLink] = useState(() => params.has("date"));
  const [selection, setSelection] = useState<Panel>();
  const savedPanel = useSyncExternalStore(subscribeToSavedPanel, readSavedPanel, () => null);
  const mobile = useSyncExternalStore(subscribeToMobile, isMobile, () => false);
  const active = selection ?? (dateLink ? "archive" : savedPanel ?? "overview");
  const start = useRef<{ x: number; y: number } | null>(null);
  const { schedules, ...outageQueue } = useOutageQueue();

  useEffect(() => {
    if (!params.has("queue")) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("queue");
    window.history.replaceState(null, "", url);
  }, [params]);

  function panelClass(panel: Panel) {
    return active === panel ? "dashboard-mobile-enter" : "max-lg:hidden";
  }

  function selectPanel(panel: Panel) {
    setSelection(panel);
    try {
      window.localStorage.setItem(panelStorageKey, panel);
    } catch {
      // The in-memory selection still works if browser storage is unavailable.
    }
    if (active !== panel) window.scrollTo({ top: 0, behavior: "instant" });
  }

  return (
    <div className="max-lg:flex max-lg:grow max-lg:flex-col max-lg:pb-[calc(3.25rem+env(safe-area-inset-bottom))]">
      {active !== "overview" && <h1 className="sr-only lg:hidden">Power Dashboard</h1>}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-card px-3.5 pt-1 pb-[calc(0.25rem+env(safe-area-inset-bottom))] sm:px-6 lg:hidden">
        <div role="tablist" aria-label="Розділи дашборда" className="mx-auto grid max-w-7xl grid-cols-3 gap-1">
          {panels.map(({ id, controls, label, icon: Icon }, index) => (
            <button key={id} id={`dashboard-tab-${id}`} type="button" role="tab" aria-controls={active === "archive" && id === "schedule" ? "outage-archive" : controls} aria-selected={active === id || (active === "archive" && id === "schedule")}
              tabIndex={active === id || (active === "archive" && id === "schedule") ? 0 : -1} onClick={() => selectPanel(id)}
              onKeyDown={(event) => {
                const next = event.key === "Home" ? 0 : event.key === "End" ? panels.length - 1
                  : event.key === "ArrowLeft" ? (index + panels.length - 1) % panels.length
                  : event.key === "ArrowRight" ? (index + 1) % panels.length : -1;
                if (next < 0) return;
                event.preventDefault();
                selectPanel(panels[next].id);
                document.getElementById(`dashboard-tab-${panels[next].id}`)?.focus();
              }}
              className={cn(
                "flex min-h-11 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-xs font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:gap-1.5 sm:text-sm",
                (active === id || (active === "archive" && id === "schedule")) ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}>
              <Icon aria-hidden="true" className="size-4 shrink-0" />{label}
            </button>
          ))}
        </div>
      </div>
      <div
        className="max-lg:flex max-lg:grow max-lg:touch-pan-y max-lg:touch-pinch-zoom max-lg:flex-col max-lg:rounded-xl max-lg:border max-lg:bg-card max-lg:shadow-xs lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-3"
        onTouchStart={(event) => {
          start.current = null;
          if (event.touches.length !== 1 || window.matchMedia("(min-width: 64rem)").matches) return;
          // A focusable tab panel is a container, not an interactive gesture target.
          if (event.target instanceof Element && event.target.closest("button, select, input, summary, a, [tabindex]:not([role='tabpanel'])")) return;
          const { clientX, clientY } = event.touches[0];
          start.current = { x: clientX, y: clientY };
        }}
        onTouchCancel={() => { start.current = null; }}
        onTouchEnd={(event) => {
          const origin = start.current;
          start.current = null;
          if (!origin || event.touches.length !== 0) return;
          const { clientX, clientY } = event.changedTouches[0];
          const dx = clientX - origin.x;
          const dy = clientY - origin.y;
          if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
          const index = panels.findIndex(({ id }) => id === (active === "archive" ? "schedule" : active));
          const next = panels[index + (dx < 0 ? 1 : -1)];
          if (next) selectPanel(next.id);
        }}
      >
        <div id="energy-overview" role={mobile ? "tabpanel" : undefined} aria-labelledby={mobile ? "dashboard-tab-overview" : undefined}
          className={cn("max-lg:flex max-lg:flex-col lg:contents", panelClass("overview"))}>
          <div className={cn(panelFrame, "lg:col-span-2 lg:order-1")}><PowerFlow queue={outageQueue.queue} schedules={schedules} onSchedule={() => { selectPanel("schedule"); if (!mobile) document.getElementById("outage-schedule")?.scrollIntoView({ behavior: "smooth", block: "start" }); }} /></div>
          <BatteryPanel className="max-lg:mx-4 max-lg:mb-4 max-lg:bg-background/50 max-lg:shadow-none sm:max-lg:mx-5 lg:order-4" />
        </div>
        <section id="station-telemetry" role={mobile ? "tabpanel" : undefined} aria-labelledby={mobile ? "dashboard-tab-telemetry" : undefined} aria-label={mobile ? undefined : "Телеметрія станції"} className={cn(panelFrame, "lg:order-2", panelClass("telemetry"))}>
          <TelemetryPanel />
        </section>
        <section id="outage-schedule" role={mobile ? "tabpanel" : undefined} aria-labelledby={mobile ? "dashboard-tab-schedule" : undefined} aria-label={mobile ? undefined : "Графік відключень"} className={cn(panelFrame, "lg:order-3", panelClass("schedule"))}>
          <OutagesPanel {...outageQueue} schedules={schedules} onHistory={() => selectPanel("archive")} />
        </section>
        <section id="outage-archive" role={mobile ? "tabpanel" : undefined} aria-labelledby={mobile ? "dashboard-tab-schedule" : undefined} aria-label={mobile ? undefined : "Історія відключень"} className={cn(panelFrame, "lg:order-5", panelClass("archive"))}>
          <OutageHistoryPanel {...outageQueue} onBack={() => selectPanel("schedule")} />
        </section>
      </div>
    </div>
  );
}
