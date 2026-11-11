"use client";

import { ArrowLeft, ArrowRight, Battery, BatteryCharging, House, Timer, UtilityPole, Zap, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { dischargeMinutes, formatDischargeTime } from "./battery-runtime";
import { useDashboardLive } from "./live";
import { MetricValue } from "./metric-value";
import { mobilePanelClassName, PanelSkeleton, StatusBadge, Timestamp } from "./panel";

const tones = {
  grid: "bg-muted text-[var(--chart-grid)]",
  station: "bg-success-surface text-success",
  home: "bg-warning-surface text-warning",
};

function FlowNode({ icon: Icon, name, value, unit, hint, tone }: {
  icon: LucideIcon;
  name: string;
  value: number | null;
  unit: string;
  hint: string;
  tone: keyof typeof tones;
}) {
  return (
    <div className={cn(
      "grid min-w-0 content-start justify-items-center gap-0.5 rounded-lg border bg-background/55 px-1.5 py-2 text-center sm:grid-cols-[auto_minmax(0,1fr)] sm:justify-items-start sm:gap-x-2.5 sm:px-3 sm:text-left",
      tone === "station" && "border-success/45 bg-success-surface/45",
    )}>
      <div className={cn("mb-0.5 grid size-6 place-items-center rounded-md sm:row-span-3 sm:mb-0 sm:size-8 sm:self-center", tones[tone])}>
        <Icon aria-hidden="true" className="size-3.5 sm:size-4" />
      </div>
      <p className="text-[0.6875rem] font-medium text-muted-foreground sm:text-xs">{name}</p>
      <p className={cn("text-[clamp(0.875rem,3.7vw,1.125rem)] leading-tight font-semibold tracking-tight wrap-anywhere sm:text-2xl",
        tone === "station" && "text-success")}>
        <MetricValue value={value} unit={unit} />
      </p>
      <p className="text-[0.625rem] leading-snug text-muted-foreground sm:text-xs">{hint}</p>
      {tone === "station" && value !== null && (
        <div role="progressbar" aria-label="Рівень заряду" aria-valuenow={value}
          className="mt-1 h-0.5 w-full overflow-hidden rounded-full bg-success/20 sm:col-span-2">
          <div className="h-full origin-left rounded-full bg-success motion-safe:transition-transform motion-safe:duration-500 motion-safe:ease-out"
            style={{ transform: `scaleX(${value / 100})` }} />
        </div>
      )}
    </div>
  );
}

function FlowLink({ direction, animate }: { direction: "right" | "left" | null; animate: boolean }) {
  const Arrow = direction === "left" ? ArrowLeft : ArrowRight;
  return (
    <div aria-hidden="true" className={cn(
      "relative flex h-px items-center justify-center self-center bg-border text-success",
      direction && "bg-success/55",
      direction && animate && "power-flow-pulse",
      direction === "left" && "power-flow-reverse",
    )}>
      {direction && <Arrow className="relative size-3 rounded-full bg-card sm:size-4" />}
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
    <Card className={cn("power-flow gap-2.5 px-4 py-3.5 sm:px-5", mobilePanelClassName)}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-success-surface text-success">
            <Zap aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0">
            <h1 className="text-base leading-tight font-semibold tracking-tight sm:text-lg">Потік енергії</h1>
            {current && <p className="text-xs text-muted-foreground wrap-break-word">{current.station.name} · {current.station.model}</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:justify-end">
          <StatusBadge tone={!measurement ? "muted" : stale ? "warning" : "success"}>{status}</StatusBadge>
          {measurement && <span title="Час виміру за Києвом" className="text-[0.6875rem] text-muted-foreground"><Timestamp value={measurement.measuredAt} /></span>}
        </div>
      </div>
      <div className="grid w-full grid-cols-[minmax(0,1fr)_clamp(14px,3vw,32px)_minmax(0,1.15fr)_clamp(14px,3vw,32px)_minmax(0,1fr)]">
        <FlowNode icon={UtilityPole} name="Мережа" value={grid === null ? null : Math.abs(grid)} unit="Вт" tone="grid"
          hint={grid === null ? "Немає даних" : grid < 0 ? "До станції" : grid > 0 ? "Від станції" : "Без обміну"} />
        <FlowLink direction={gridDirection} animate={!stale} />
        <FlowNode icon={BatteryCharging} name="Станція" value={measurement?.socPct ?? null} unit="%" tone="station"
          hint={battery === null ? "Немає даних" : battery < 0 ? "Розряд" : battery > 0 ? "Заряд" : "У спокої"} />
        <FlowLink direction={home !== null && home > 0 ? "right" : null} animate={!stale} />
        <FlowNode icon={House} name="Дім" value={home === null || home < 0 ? null : home} unit="Вт" tone="home"
          hint="Резервний вихід" />
      </div>
      {current && (
        <dl className="grid gap-y-1 border-t pt-2 text-xs sm:grid-cols-2 sm:gap-x-4">
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 sm:border-r sm:pr-4">
            <dt className="flex items-center gap-1.5 text-muted-foreground">
              <Battery aria-hidden="true" className="size-3.5 shrink-0 text-success" />
              Потужність батареї
            </dt>
            <dd className="font-semibold whitespace-nowrap"><MetricValue value={battery} unit="Вт" signed /></dd>
          </div>
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2"
            title="Залишок енергії поділено на поточну потужність розряду батареї">
            <dt className="flex items-center gap-1.5 text-muted-foreground">
              <Timer aria-hidden="true" className="size-3.5 shrink-0 text-success" />
              До повного розряду
            </dt>
            <dd className={cn("font-semibold tabular-nums", runtime === null ? "text-muted-foreground" : "text-success")}>{runtimeText}</dd>
          </div>
        </dl>
      )}
    </Card>
  );
}
