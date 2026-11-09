"use client";

import { ArrowLeft, ArrowRight, BatteryCharging, House, UtilityPole, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useDashboardLive } from "./live";
import { PanelSkeleton, Timestamp } from "./panel";

const number = new Intl.NumberFormat("uk-UA");

function reading(value: number | null, unit: string) {
  if (value === null) return <span aria-label="Немає даних">—</span>;
  return <>{number.format(Math.abs(value))}<span className="ml-1 text-xs font-medium text-slate-300 sm:text-sm">{unit}</span></>;
}

function FlowNode({
  icon: Icon, name, value, hint, tone,
}: {
  icon: LucideIcon;
  name: string;
  value: ReactNode;
  hint: string;
  tone: "grid" | "station" | "home";
}) {
  const tones = {
    grid: "bg-sky-400/15 text-sky-200",
    station: "bg-emerald-400/20 text-emerald-200",
    home: "bg-amber-400/15 text-amber-200",
  };

  return (
    <div className={cn(
      "flex h-full min-w-0 flex-col items-center rounded-xl border border-white/12 bg-slate-950/45 px-1 py-3 text-center sm:rounded-2xl sm:px-3 sm:py-5",
      tone === "station" && "border-emerald-300/30 bg-emerald-950/55",
    )}>
      <div className={cn("mb-2.5 grid size-9 shrink-0 place-items-center rounded-lg sm:size-11 sm:rounded-xl", tones[tone])}>
        <Icon aria-hidden="true" className="size-[18px] sm:size-[22px]" />
      </div>
      <p className="text-xs font-medium text-slate-200 sm:text-sm">{name}</p>
      <p className="mt-0.5 text-lg leading-tight font-semibold tracking-tight tabular-nums sm:text-3xl">{value}</p>
      <p className="mt-1 text-[0.65rem] leading-snug text-slate-300 sm:text-xs">{hint}</p>
    </div>
  );
}

function FlowLink({ direction, animate }: { direction: "right" | "left" | null; animate: boolean }) {
  const Arrow = direction === "left" ? ArrowLeft : ArrowRight;
  return (
    <div aria-hidden="true" className={cn(
      "relative flex h-px items-center justify-center bg-slate-500/65 text-emerald-200",
      direction && "bg-emerald-400/65",
      direction && animate && "power-flow-pulse",
      direction === "left" && "power-flow-reverse",
    )}>
      {direction && <Arrow className="relative size-3.5 rounded-full bg-[#15333a] sm:size-5" />}
    </div>
  );
}

export function PowerFlow() {
  const { station, stationStale: stale, connection } = useDashboardLive();
  if (!station && connection === "connecting") return <PanelSkeleton label="Завантаження потоку енергії" />;
  const measurement = station?.kind === "station" ? station.measurement : null;
  const grid = measurement?.gridPowerW ?? null;
  const battery = measurement?.batteryPowerW ?? null;
  const home = measurement?.backupLoadPowerW ?? null;
  const gridDirection = grid === null || grid === 0 ? null : grid < 0 ? "right" : "left";

  return (
    <Card className="power-flow gap-4 rounded-2xl border-[#28424b] px-3.5 py-4 text-slate-50 sm:gap-5 sm:px-6 sm:py-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold tracking-tight sm:text-2xl">Потік енергії</h2>
          <p className="mt-0.5 text-xs text-slate-300 sm:text-sm">Обмін із мережею, заряд станції та резервне навантаження</p>
        </div>
        <span className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
          !measurement ? "border-white/20 text-slate-300" : stale ?
            "border-amber-300/35 text-amber-200" : "border-emerald-300/35 text-emerald-200",
        )}>
          <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
          {!measurement ? "Очікує на дані" : stale ? "Останній відомий стан" : "Актуальні дані"}
        </span>
      </div>
      <div className="mx-auto grid w-full max-w-4xl grid-cols-[minmax(0,1fr)_clamp(12px,4vw,72px)_minmax(0,1fr)_clamp(12px,4vw,72px)_minmax(0,1fr)] items-center">
        <FlowNode icon={UtilityPole} name="Міська мережа" value={reading(grid, "Вт")} tone="grid"
          hint={grid === null ? "Немає даних" : grid < 0 ? "До станції" : grid > 0 ? "Від станції" : "Без обміну"} />
        <FlowLink direction={gridDirection} animate={!stale} />
        <FlowNode icon={BatteryCharging} name="Станція" value={reading(measurement?.socPct ?? null, "%")} tone="station"
          hint={battery === null ? "Немає даних" : battery < 0 ? "Розряд" : battery > 0 ? "Заряд" : "У спокої"} />
        <FlowLink direction={home !== null && home > 0 ? "right" : null} animate={!stale} />
        <FlowNode icon={House} name="Дім" value={reading(home === null || home < 0 ? null : home, "Вт")} tone="home" hint="Резервний вихід" />
      </div>
      {measurement && <p className="text-xs text-slate-300">Вимір за Києвом · <Timestamp value={measurement.measuredAt} /></p>}
    </Card>
  );
}
