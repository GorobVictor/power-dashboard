"use client";

import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BatteryCharging, House, Timer, UtilityPole, Zap, type LucideIcon } from "lucide-react";
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

function FlowNode({ icon: Icon, name, value, hint, tone, loading }: {
  icon: LucideIcon;
  name: string;
  value: number | null;
  hint: string;
  tone: "grid" | "battery" | "home";
  loading?: boolean;
}) {
  return (
    <div className="grid min-w-0 content-start justify-items-center gap-1 text-center">
      <div className={cn("mb-1 grid size-9 place-items-center rounded-full border bg-background/60", tone === "grid" ? "text-[var(--chart-grid)]" : tone === "home" ? "text-warning" : "text-success")}>
        {loading ? <Skeleton className="size-4" /> : <Icon aria-hidden="true" className="size-4" />}
      </div>
      <p className="text-base leading-tight font-semibold tracking-tight sm:text-lg">
        {loading ? <Skeleton className="h-5 w-14" /> : <MetricValue value={value} unit="Вт" />}
      </p>
      <p className="text-xs font-medium text-muted-foreground">{name}</p>
      <p className="text-xs leading-tight text-muted-foreground">{loading ? <Skeleton className="h-3 w-16" /> : hint}</p>
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
  const ac = measurement?.acOutputPowerW ?? null;
  const chargingInput = battery !== null && battery > 0 && ac !== null && ac < 0 ? -ac : null;
  const chargingDifference = chargingInput !== null && battery !== null ? chargingInput - battery : null;
  const stale = stationStale || connection !== "connected";
  const bypass = measurement?.inverterState === 6;
  const runtime = stale || bypass ? null : dischargeMinutes(measurement?.remainingEnergyWh ?? null, battery);
  const runtimeText = runtime !== null ? formatDischargeTime(runtime)
    : !measurement ? "Немає вимірів"
    : stale ? "Потрібні свіжі дані"
    : bypass ? "Режим байпаса"
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
          {loading ? <Skeleton className="mt-1 h-4 w-4/5" /> : measurement && (stale ? "Показано останні відомі значення" : flowSummary(battery, grid, home, measurement.inverterState))}
        </p>
      </div>
      <div className="mx-auto grid w-full max-w-lg grid-cols-[minmax(0,1fr)_clamp(12px,5vw,32px)_minmax(70px,0.8fr)_clamp(12px,5vw,32px)_minmax(0,1fr)] items-start pt-1">
        <FlowNode icon={UtilityPole} name="Мережа" value={grid === null ? null : Math.abs(grid)} tone="grid" loading={loading}
          hint={grid === null ? "Немає даних" : grid < 0 ? "До станції" : grid > 0 ? "Від станції" : "Без обміну"} />
        <div className="mt-5"><FlowLink direction={gridDirection} animate={!stale} /></div>
        <div className="grid min-w-0 justify-items-center text-center">
          <div className="grid size-14 place-items-center rounded-2xl border border-success/35 bg-success-surface text-success shadow-[0_0_24px_-8px_var(--success)]">
            <Zap aria-hidden="true" className="size-6" />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">Станція</p>
          <p className="text-sm font-semibold">{loading ? <Skeleton className="h-4 w-12" /> : <MetricValue value={measurement?.socPct ?? null} unit="%" />}</p>
        </div>
        <div className="mt-5"><FlowLink direction={home !== null && home > 0 ? "right" : null} animate={!stale} /></div>
        <FlowNode icon={House} name="Резерв" value={home === null || home < 0 ? null : home} tone="home" loading={loading}
          hint={home === null || home < 0 ? "Немає даних" : bypass && grid !== null && grid < 0 ? "Байпас" : "Резервний вихід"} />
        <div className="col-start-3 row-start-2 grid justify-items-center">
          <div aria-hidden="true" className="relative flex h-7 w-px items-center justify-center bg-border text-success">
            {battery !== null && battery !== 0 && (battery > 0 ? <ArrowDown className="size-4 shrink-0 bg-card" /> : <ArrowUp className="size-4 shrink-0 bg-card" />)}
          </div>
          <FlowNode icon={BatteryCharging} name="Батарея" value={battery === null ? null : Math.abs(battery)} tone="battery" loading={loading}
            hint={battery === null ? "Немає даних" : battery > 0 ? "Заряд" : battery < 0 ? "Розряд" : "У спокої"} />
        </div>
      </div>
      {(chargingInput !== null || (bypass && grid !== null && grid < 0 && home !== null && home >= 0)) && (
        <div className="border-t pt-3 text-xs leading-relaxed text-muted-foreground">
          {bypass && grid !== null && grid < 0 && home !== null && home >= 0 && (
            <p>Мережа → резерв через байпас: <strong className="text-foreground">≈ <MetricValue value={home} unit="Вт" /></strong></p>
          )}
          {chargingInput !== null && (
            <details>
              <summary className="cursor-pointer">Детальніше про заряд</summary>
              <p className="mt-1">На заряд: <strong className="text-foreground"><MetricValue value={chargingInput} unit="Вт" /> AC → <MetricValue value={battery} unit="Вт" /> у батарею</strong></p>
              <p className="mt-1">Різниця: <MetricValue value={chargingDifference === null ? null : Math.abs(chargingDifference)} unit="Вт" />{chargingDifference !== null && chargingDifference < 0 && " · батарея показує більше"}. Вона може включати втрати, власне споживання і похибку.</p>
            </details>
          )}
        </div>
      )}
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
