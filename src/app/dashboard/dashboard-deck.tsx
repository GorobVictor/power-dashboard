"use client";

import { Activity, CalendarClock, History, Zap } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { BatteryPanel } from "./battery";
import { OutageHistoryPanel, OutagesPanel, useOutageQueue } from "./outages";
import { PowerFlow } from "./power-flow";
import { TelemetryPanel } from "./telemetry";

const panels = [
  { id: "overview", controls: "energy-overview station-details", label: "Огляд", icon: Zap },
  { id: "schedule", controls: "outage-schedule", label: "Графік", icon: CalendarClock },
  { id: "archive", controls: "outage-archive", label: "Архів", icon: History },
  { id: "telemetry", controls: "station-telemetry", label: "Виміри", icon: Activity },
] as const;

const panelFrame = "min-w-0 lg:grid";
const panelStorageKey = "power-dashboard.active-panel";
type Panel = typeof panels[number]["id"];

function readSavedPanel() {
  try {
    const saved = window.localStorage.getItem(panelStorageKey);
    return panels.find(({ id }) => id === saved)?.id ?? null;
  } catch {
    return null;
  }
}

function subscribeToSavedPanel(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

export function DashboardDeck() {
  const params = useSearchParams();
  const [defaultPanel] = useState<Panel>(() => params.has("date") ? "archive" : "overview");
  const [selection, setSelection] = useState<Panel>();
  const savedPanel = useSyncExternalStore(subscribeToSavedPanel, readSavedPanel, () => null);
  const active = selection ?? savedPanel ?? defaultPanel;
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
    <div className="max-lg:flex max-lg:grow max-lg:flex-col">
      {active !== "overview" && <h1 className="sr-only lg:hidden">Power Dashboard</h1>}
      <div className="sticky top-0 z-20 bg-background pb-3 lg:hidden">
        <div role="group" aria-label="Картки дашборда" className="grid grid-cols-4 gap-1 rounded-xl border bg-card p-1 shadow-xs">
          {panels.map(({ id, controls, label, icon: Icon }) => (
            <button key={id} type="button" aria-controls={controls} aria-pressed={active === id} onClick={() => selectPanel(id)}
              className={cn(
                "flex min-h-11 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-xs font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:gap-1.5 sm:text-sm",
                active === id ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
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
          const index = panels.findIndex(({ id }) => id === active);
          const next = panels[index + (dx < 0 ? 1 : -1)];
          if (next) selectPanel(next.id);
        }}
      >
        <div id="energy-overview" className={cn(panelFrame, "lg:col-span-2", panelClass("overview"))}>
          <PowerFlow />
        </div>
        <section id="station-telemetry" aria-label="Телеметрія станції" className={cn(panelFrame, panelClass("telemetry"))}>
          <TelemetryPanel />
        </section>
        <section id="outage-schedule" aria-label="Графік відключень" className={cn(panelFrame, panelClass("schedule"))}>
          <OutagesPanel {...outageQueue} schedules={schedules} />
        </section>
        <BatteryPanel className={cn("max-lg:mx-4 max-lg:mb-4 max-lg:bg-background/50 max-lg:shadow-none sm:max-lg:mx-5", panelClass("overview"))} />
        <section id="outage-archive" aria-label="Історія відключень" className={cn(panelFrame, panelClass("archive"))}>
          <OutageHistoryPanel {...outageQueue} />
        </section>
      </div>
    </div>
  );
}
