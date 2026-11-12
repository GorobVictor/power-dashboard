"use client";

import { ArrowLeft, ArrowRight, BatteryCharging, House, Timer, UtilityPole, Zap, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { DashboardSchedule } from "@/lib/dashboard-feed";
import { telemetryWindow } from "@/lib/telemetry-history";
import { clockTime, kyivMinute, outageIntervals, scheduleBands, scheduleIntervals } from "@/server/outages/intervals";
import { timeZone } from "@/server/outages/schedules";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { dischargeMinutes, formatDischargeTime } from "./battery-runtime";
import { flowSummary, measurementAge } from "./flow-status";
import { useDashboardLive } from "./live";
import { MetricValue } from "./metric-value";
import { mobilePanelClassName, StatusBadge, Timestamp } from "./panel";

const tones = {
  grid: "bg-muted text-[var(--chart-grid)]",
  station: "bg-success-surface text-success",
  home: "bg-warning-surface text-warning",
};

function FlowNode({ icon: Icon, name, value, unit, hint, tone, battery, loading }: {
  icon: LucideIcon;
  name: string;
  value: number | null;
  unit: string;
  hint: string;
  tone: keyof typeof tones;
  battery?: number | null;
  loading?: boolean;
}) {
  return (
    <div className={cn(
      "grid min-w-0 content-start justify-items-center gap-1 rounded-xl border bg-background/55 px-1.5 py-3 text-center sm:grid-cols-[auto_minmax(0,1fr)] sm:justify-items-start sm:gap-x-2.5 sm:px-3 sm:py-2 sm:text-left",
      tone === "station" && (battery == null || battery === 0 ? "border-border bg-muted/55" : battery < 0 ? "border-warning/45 bg-warning-surface/45" : "border-success/45 bg-success-surface/45"),
    )}>
      <div className={cn("mb-0.5 grid size-8 place-items-center rounded-lg sm:row-span-3 sm:mb-0 sm:size-8 sm:self-center", tone === "station" && battery != null && battery < 0 ? tones.home : tone === "station" && (battery == null || battery === 0) ? tones.grid : tones[tone])}>
        {loading ? <Skeleton className="size-4" /> : <Icon aria-hidden="true" className="size-4" />}
      </div>
      <p className="text-xs font-medium text-muted-foreground sm:text-xs">{loading ? <Skeleton className="h-3 w-12" /> : name}</p>
      <p className={cn("text-[clamp(1rem,4.5vw,1.25rem)] leading-tight font-semibold tracking-tight wrap-anywhere sm:text-2xl",
        tone === "station" && (battery == null || battery === 0 ? "text-foreground" : battery < 0 ? "text-warning" : "text-success"))}>
        {loading ? <Skeleton className="my-1 h-4 w-12 sm:h-6" /> : <MetricValue value={value} unit={unit} />}
      </p>
      <p className="min-h-[2.75em] text-xs leading-snug text-muted-foreground sm:text-xs">{loading ? <Skeleton className="mt-1 h-3 w-16 max-w-full" /> : <>{hint}{tone === "station" && value === null && <> · Заряд невідомий</>}</>}</p>
      {tone === "station" && (
        <div role="progressbar" aria-label="Рівень заряду" aria-valuenow={value ?? undefined}
          className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-foreground/15 sm:col-span-2">
          <div className={cn("h-full origin-left rounded-full motion-safe:transition-transform motion-safe:duration-500 motion-safe:ease-out", battery == null || battery === 0 ? "bg-muted-foreground" : battery < 0 ? "bg-warning" : "bg-success")}
            style={{ transform: `scaleX(${(value ?? 0) / 100})` }} />
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
      direction && (animate ? "bg-success/55" : "bg-muted-foreground/35 text-muted-foreground/60"),
      direction && animate && "power-flow-pulse",
      direction === "left" && "power-flow-reverse",
    )}>
      {direction && <Arrow className="relative size-4 shrink-0 rounded-full bg-card sm:size-5" />}
    </div>
  );
}

function MeasurementTime({ measuredAt, initialNow }: { measuredAt: string; initialNow: number }) {
  const [now, setNow] = useState(initialNow);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <details className="w-36 text-xs text-muted-foreground"><summary className="cursor-pointer">Оновлено {measurementAge(measuredAt, Math.max(now, initialNow))}</summary><span className="block pt-1">Київський час: <Timestamp value={measuredAt} /></span></details>;
}

export function PowerFlow({ queue, schedules, onSchedule }: { queue: string | null; schedules: DashboardSchedule[]; onSchedule: () => void }) {
  const { station, stationStale, connection, outages, outagesStale, today, now } = useDashboardLive();
  const loading = !station && connection === "connecting";
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
  const schedule = queue ? schedules.find((item) => item.queue === queue && item.date === today) : undefined;
  const scheduleFresh = Boolean(outages?.lastSuccessfulPollAt) && !outagesStale && connection === "connected";
  const completePlan = schedule?.status === "ScheduleApplies" && schedule.hours.length === 24 && !schedule.hours.includes(9);
  const minute = now ? kyivMinute(now) : 0;
  const next = completePlan && scheduleFresh ? outageIntervals(schedule.hours).find((item) => item.end > minute) : undefined;
  const ongoing = next && next.start <= minute;
  const day = today ? telemetryWindow({ from: today, to: today }) : null;
  const elapsed = day ? (now - day.start) / 60_000 : 0;
  const currentBand = ongoing && schedule && day ? scheduleBands(scheduleIntervals(schedule), day).find((item) => item.kind === "outage" && item.start <= elapsed && item.end > elapsed) : undefined;
  const forecast = runtime !== null && now && runtime < 365 * 24 * 60 ? new Date(now + runtime * 60_000) : null;
  const forecastTime = forecast ? new Intl.DateTimeFormat("uk-UA", { timeZone, dateStyle: "short", timeStyle: "short" }).format(forecast) : null;
  const gridDirection = grid === null || grid === 0 ? null : grid < 0 ? "right" : "left";
  const status = station?.kind === "unconfigured" ? "Станцію не налаштовано"
    : station?.kind === "missing" ? "Станцію не знайдено"
    : !station ? "Дані недоступні"
    : !measurement ? "Очікуємо на вимір"
    : stale ? "Останній відомий стан" : "Актуальні дані";

  return (
    <Card aria-busy={loading} className={cn("power-flow gap-4 px-4 py-5 sm:px-5", mobilePanelClassName)}>
      {loading && <span role="status" className="sr-only">Завантаження потоку енергії</span>}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-success-surface text-success">
            <Zap aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0">
            <h1 className="text-base leading-tight font-semibold tracking-tight sm:text-lg">Потік енергії</h1>
            {loading ? <Skeleton className="mt-1 h-3 w-36" /> : current && <p className="text-xs text-muted-foreground wrap-break-word">{current.station.name} · {current.station.model}</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:justify-end">
          {loading ? <Skeleton className="h-5 w-44" /> : <StatusBadge className="justify-center" tone={!measurement ? "muted" : stale ? "warning" : "success"}>{status}</StatusBadge>}
          {loading ? <Skeleton className="h-3 w-36" /> : measurement && <MeasurementTime measuredAt={measurement.measuredAt} initialNow={now} />}
        </div>
      </div>
      <div className="grid text-sm font-medium">
        <p aria-hidden="true" className="invisible col-start-1 row-start-1 max-lg:hidden">Батарея розряджається · резервний вихід працює</p>
        <p className={cn("col-start-1 row-start-1", stale ? "text-muted-foreground" : "text-foreground")}>
          {loading ? <Skeleton className="mt-1 h-4 w-4/5" /> : measurement && (stale ? "Показано останні відомі значення" : flowSummary(battery, grid, home))}
        </p>
      </div>
      <div className="grid w-full grid-cols-[minmax(0,1fr)_clamp(14px,3vw,32px)_minmax(0,1.15fr)_clamp(14px,3vw,32px)_minmax(0,1fr)]">
        <FlowNode icon={UtilityPole} name="Мережа" value={grid === null ? null : Math.abs(grid)} unit="Вт" tone="grid" loading={loading}
          hint={grid === null ? "Немає даних" : grid < 0 ? "До станції" : grid > 0 ? "Від станції" : "Без обміну"} />
        <FlowLink direction={gridDirection} animate={!stale} />
        <FlowNode icon={BatteryCharging} name="Станція" value={measurement?.socPct ?? null} unit="%" tone="station" battery={battery} loading={loading}
          hint={battery === null ? "Немає даних про батарею" : battery === 0 ? "У спокої · 0 Вт" : `${battery < 0 ? "Розряд" : "Заряд"} · ${new Intl.NumberFormat("uk-UA").format(Math.abs(battery))} Вт`} />
        <FlowLink direction={home !== null && home > 0 ? "right" : null} animate={!stale} />
        <FlowNode icon={House} name="Резерв" value={home === null || home < 0 ? null : home} unit="Вт" tone="home" loading={loading}
          hint={home === null || home < 0 ? "Немає даних" : "Резервний вихід"} />
      </div>
      <div className="grid rounded-xl bg-muted/45 px-3.5 py-3 text-sm" title="Залишок енергії поділено на поточну потужність розряду батареї">
        <div aria-hidden="true" className="invisible col-start-1 row-start-1 max-lg:hidden">
          <p>◷ &nbsp; Час роботи: &nbsp; ≈ 1 дн 9 год за поточного навантаження · орієнтовно до 14.11.26, 05:00</p>
          <p className="mt-1">Навантаження може змінитися. За поточним графіком заряд може закінчитися до кінця відключення.</p>
        </div>
        <div className="col-start-1 row-start-1">
        {loading ? <div className="space-y-2"><Skeleton className="h-3 w-3/4" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-4/5" /></div> : <>
        <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          <Timer aria-hidden="true" className="size-3.5 shrink-0 self-center text-success" />
          <span className="text-muted-foreground">Час роботи:</span> <span className="font-semibold tabular-nums">{runtimeText}</span>
          {runtime !== null && <span className="text-muted-foreground">за поточного навантаження{forecastTime ? ` · орієнтовно до ${forecastTime}` : ""}</span>}
        </p>
        {runtime !== null && <p className="mt-1 text-muted-foreground">Навантаження може змінитися.
          {currentBand && <> {runtime >= currentBand.end - elapsed ? "За поточним графіком заряду може вистачити до кінця відключення." : "За поточним графіком заряд може закінчитися до кінця відключення."}</>}
        </p>}
        </>}
        </div>
      </div>
      <button type="button" onClick={onSchedule} className={cn("grid min-h-12 rounded-xl border bg-background/70 px-3.5 py-3 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring", queue && (!scheduleFresh || schedule?.status === "EmergencyShutdowns" || schedule?.hours.includes(9)) && "border-warning/45 bg-warning-surface/45")}>
        <span aria-hidden="true" className="invisible col-start-1 row-start-1 max-lg:hidden">Черга 3.2 · Графік неактуальний або недоступний →</span>
        <span className="col-start-1 row-start-1">{loading ? <Skeleton className="h-4 w-3/4" /> : <><span className="font-semibold">{queue ? `Черга ${queue}` : "Графік відключень"}</span>{" · "}
        {!queue ? "Оберіть чергу" : !scheduleFresh ? "Графік неактуальний або недоступний" : !schedule ? "Графік на сьогодні недоступний" : schedule.status === "NoShutdowns" ? "Сьогодні без відключень" : schedule.status === "EmergencyShutdowns" || schedule.hours.includes(9) ? "Аварійні обмеження" : !completePlan ? "Графік неповний або очікується" : next ? ongoing ? `Відключення до ${clockTime(next.end)}` : `Наступне: ${clockTime(next.start)}–${clockTime(next.end)}` : "Сьогодні більше без відключень"}
        <span className="ml-1 text-muted-foreground">→</span></>}</span>
      </button>
    </Card>
  );
}
