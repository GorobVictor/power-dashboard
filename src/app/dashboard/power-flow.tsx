"use client";

import { ArrowLeft, ArrowRight, Battery, BatteryCharging, House, Timer, UtilityPole, Zap, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { dischargeMinutes, formatDischargeTime } from "./battery-runtime";
import { useDashboardLive } from "./live";
import { MetricValue } from "./metric-value";
import { mobilePanelClassName, PanelSkeleton, StatusBadge, Timestamp } from "./panel";

const tones = {
  grid: "bg-muted text-muted-foreground lg:bg-sky-400/15 lg:text-sky-200",
  station: "bg-success-surface text-success lg:bg-emerald-400/20 lg:text-emerald-200",
  home: "bg-warning-surface text-warning lg:bg-amber-400/15 lg:text-amber-200",
};

function FlowNode({
  icon: Icon, name, value, unit, hint, tone, batteryPowerW,
}: {
  icon: LucideIcon;
  name: string;
  value: number | null;
  unit: string;
  hint: string;
  tone: keyof typeof tones;
  batteryPowerW?: number | null;
}) {
  return (
    <div className={cn(
      "grid min-w-0 grid-rows-[auto_auto_auto_1fr] justify-items-center gap-y-1 rounded-lg border bg-background/50 px-1 py-2.5 text-center sm:px-3 sm:py-3 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:grid-rows-[auto_auto_1fr] lg:items-center lg:gap-x-3 lg:gap-y-0.5 lg:rounded-xl lg:border-white/12 lg:bg-slate-950/45 lg:px-3.5 lg:text-left",
      tone === "station" && "border-success/30 bg-success-surface/40 lg:border-emerald-300/35 lg:bg-emerald-950/55",
    )}>
      <div className={cn("mb-0.5 grid size-8 place-items-center rounded-lg sm:size-9 lg:row-span-2 lg:mb-0", tones[tone])}>
        <Icon aria-hidden="true" className="size-[18px]" />
      </div>
      <p className="text-xs font-medium sm:text-sm lg:justify-self-start lg:text-slate-200">{name}</p>
      <p className="text-[clamp(1rem,4.5vw,1.25rem)] leading-tight font-semibold tracking-tight whitespace-nowrap sm:text-2xl lg:col-start-3 lg:row-span-2 lg:row-start-1 lg:justify-self-end">
        <MetricValue value={value} unit={unit} />
      </p>
      <p className="text-[0.6875rem] leading-snug text-muted-foreground sm:text-xs lg:col-start-2 lg:row-start-2 lg:justify-self-start lg:text-slate-300">{hint}</p>
      {batteryPowerW !== undefined && (
        <p className="col-span-3 row-start-3 mt-1 hidden w-full flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 self-end border-t border-white/12 pt-1.5 text-xs leading-snug text-slate-300 lg:flex">
          <span>Потужність батареї</span>
          <span className="font-semibold whitespace-nowrap text-slate-100"><MetricValue value={batteryPowerW} unit="Вт" signed /></span>
        </p>
      )}
      {tone === "station" && (
        <div
          role={value === null ? undefined : "progressbar"} aria-label="Рівень заряду" aria-valuenow={value ?? undefined}
          aria-hidden={value === null}
          className="mt-1.5 h-1 w-[80%] self-end overflow-hidden rounded-full bg-success/20 sm:max-w-36 lg:col-span-3 lg:row-start-3 lg:mt-2 lg:w-full lg:max-w-none lg:bg-emerald-200/15"
        >
          <div
            className="h-full origin-left rounded-full bg-success motion-safe:transition-transform motion-safe:duration-500 motion-safe:ease-out lg:bg-emerald-200"
            style={{ transform: `scaleX(${(value ?? 0) / 100})` }}
          />
        </div>
      )}
    </div>
  );
}

function FlowLink({ direction, animate }: { direction: "right" | "left" | null; animate: boolean }) {
  const Arrow = direction === "left" ? ArrowLeft : ArrowRight;
  return (
    <div aria-hidden="true" className={cn(
      "relative flex h-px items-center justify-center self-center bg-border text-success lg:bg-slate-500/65 lg:text-emerald-200",
      direction && "bg-success/65 lg:bg-emerald-400/65",
      direction && animate && "power-flow-pulse",
      direction === "left" && "power-flow-reverse",
    )}>
      {direction && <Arrow className="relative size-3.5 rounded-full bg-card sm:size-4 lg:bg-[#15333a]" />}
    </div>
  );
}

export function PowerFlow() {
  const { station, stationStale, connection } = useDashboardLive();
  if (!station && connection === "connecting") return <PanelSkeleton label="Завантаження потоку енергії" className={mobilePanelClassName} />;
  const current = station?.kind === "station" ? station : null;
  const measurement = current?.measurement;
  const grid = measurement?.gridPowerW ?? null;
  const battery = measurement?.batteryPowerW ?? null;
  const home = measurement?.backupLoadPowerW ?? null;
  const stale = stationStale || connection !== "connected";
  const runtime = stale ? null : dischargeMinutes(measurement?.remainingEnergyWh ?? null, battery);
  const runtimeText = runtime !== null ? formatDischargeTime(runtime)
    : !measurement ? "Немає вимірів"
    : stale ? "Потрібні свіжі дані"
    : battery !== null && battery >= 0 ? "Без розряду" : "Бракує даних";
  const gridDirection = grid === null || grid === 0 ? null : grid < 0 ? "right" : "left";
  const status = station?.kind === "unconfigured" ? "Станцію не налаштовано"
    : station?.kind === "missing" ? "Станцію не знайдено"
    : !station ? "Дані недоступні"
    : !measurement ? "Очікуємо на вимір"
    : stale ? "Останній відомий стан" : "Актуальні дані";

  return (
    <Card className={cn("power-flow gap-3 px-4 py-4 sm:px-5 lg:gap-4 lg:border-[#28424b] lg:py-5 lg:text-slate-50", mobilePanelClassName)}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-base font-semibold tracking-tight wrap-break-word sm:text-lg lg:text-2xl">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-success-surface text-success lg:hidden">
              <Zap aria-hidden="true" className="size-4" />
            </span>
            <span className="min-w-0">{current?.station.name ?? "Потік енергії"}</span>
          </h1>
          {current && <p className="mt-0.5 text-xs text-muted-foreground lg:mt-1 lg:text-slate-300">Потік енергії · {current.station.model}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 sm:justify-end">
          <StatusBadge tone={!measurement ? "muted" : stale ? "warning" : "success"}>{status}</StatusBadge>
          {measurement && <span title="Час виміру за Києвом" className="text-xs text-muted-foreground lg:text-slate-300"><Timestamp value={measurement.measuredAt} /></span>}
        </div>
      </div>
      <div className="grid w-full grid-cols-[minmax(0,1fr)_clamp(12px,3.5vw,44px)_minmax(0,1fr)_clamp(12px,3.5vw,44px)_minmax(0,1fr)]">
        <FlowNode icon={UtilityPole} name="Мережа" value={grid === null ? null : Math.abs(grid)} unit="Вт" tone="grid"
          hint={grid === null ? "Немає даних" : grid < 0 ? "До станції" : grid > 0 ? "Від станції" : "Без обміну"} />
        <FlowLink direction={gridDirection} animate={!stale} />
        <FlowNode icon={BatteryCharging} name="Станція" value={measurement?.socPct ?? null} unit="%" tone="station"
          hint={battery === null ? "Немає даних" : battery < 0 ? "Розряд" : battery > 0 ? "Заряд" : "У спокої"} />
        <FlowLink direction={home !== null && home > 0 ? "right" : null} animate={!stale} />
        <FlowNode icon={House} name="Дім" value={home === null || home < 0 ? null : home} unit="Вт" tone="home"
          hint="Резервний вихід" batteryPowerW={battery} />
      </div>
      {current && (
        <div className="divide-y rounded-lg border bg-background/50 lg:border-emerald-200/15 lg:bg-emerald-950/35">
          <div className="flex min-h-9 items-center justify-between gap-2 px-2.5 py-1.5 text-xs sm:px-3 sm:text-sm lg:hidden">
            <p className="flex items-center gap-2 font-medium">
              <Battery aria-hidden="true" className="size-4 shrink-0 text-success" />
              Потужність батареї
            </p>
            <p className="font-semibold whitespace-nowrap"><MetricValue value={battery} unit="Вт" signed /></p>
          </div>
          <div className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-2.5 py-1.5 sm:px-3"
            title="Залишок енергії поділено на поточну потужність розряду батареї">
            <div className="flex items-center gap-2">
              <Timer aria-hidden="true" className="size-4 shrink-0 text-success lg:text-emerald-200" />
              <div>
                <p className="text-xs font-medium sm:text-sm">До повного розряду</p>
                <p className="text-[0.625rem] text-muted-foreground sm:text-xs lg:text-slate-300">За поточного розряду</p>
              </div>
            </div>
            <p className={cn("text-right text-xs font-semibold tabular-nums sm:text-sm", runtime === null ? "text-muted-foreground lg:text-slate-300" : "text-success lg:text-emerald-200")}>{runtimeText}</p>
          </div>
        </div>
      )}
    </Card>
  );
}
