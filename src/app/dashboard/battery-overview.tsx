"use client";

import { BatteryCharging, Clock3, Zap } from "lucide-react";
import { Card } from "@/components/ui/card";
import { dischargeMinutes, formatDischargeTime } from "./battery-runtime";
import { useDashboardLive } from "./live";
import { MetricValue } from "./metric-value";
import { mobilePanelClassName, StatusBadge } from "./panel";
import { cn } from "@/lib/utils";

export function BatteryOverview({ className }: { className?: string }) {
  const { station, stationStale, connection } = useDashboardLive();
  if (station?.kind !== "station" || !station.measurement) return null;
  const { measurement, station: device } = station;
  const stale = stationStale || connection !== "connected";
  const { socPct, batteryPowerW, remainingEnergyWh, inverterState } = measurement;
  const runtime = stale || inverterState === 6 ? null : dischargeMinutes(remainingEnergyWh, batteryPowerW);
  const status = stale ? "Останні дані" : inverterState === 6 ? "Байпас" : batteryPowerW === null ? "Стан невідомий"
    : batteryPowerW > 0 ? "Заряджається" : batteryPowerW < 0 ? "Розряджається" : "У спокої";
  const energy = remainingEnergyWh === null ? null : remainingEnergyWh >= 1000 ? remainingEnergyWh / 1000 : remainingEnergyWh;

  return (
    <Card className={cn("battery-overview gap-2.5 px-4 py-3 sm:px-5 lg:gap-4 lg:py-4", mobilePanelClassName, className)}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1">
        <p className="text-[0.65rem] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Ваша батарея</p>
        <StatusBadge tone={stale ? "warning" : "success"}>{status}</StatusBadge>
        <h2 className="col-span-2 text-lg font-semibold tracking-tight wrap-break-word">{device.name}</h2>
      </div>
      <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-3 lg:grid-cols-[minmax(100px,0.85fr)_minmax(0,1fr)] lg:gap-5">
        <div className="mx-auto grid aspect-square w-full max-w-36 place-items-center rounded-full p-[5px] lg:p-[7px]" style={{ background: socPct === null ? "var(--muted)" : `conic-gradient(var(--chart-charge) ${socPct}%, var(--muted) ${socPct}%)` }}>
          <div className="grid size-full content-center justify-items-center rounded-full bg-card text-center">
            <BatteryCharging aria-hidden="true" className="mb-1 hidden size-4 text-success lg:block" />
            <span className="text-xl font-semibold tracking-tight lg:text-3xl"><MetricValue value={socPct} unit="%" /></span>
            <span className="sr-only lg:not-sr-only lg:mt-0.5 lg:text-[0.65rem] lg:text-muted-foreground">Рівень заряду</span>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-2 lg:grid-cols-1">
          <div className="min-w-0 rounded-xl bg-muted/55 px-2 py-2 lg:px-3 lg:py-2.5"><dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><Zap aria-hidden="true" className="hidden size-3.5 lg:block" /> Запас енергії</dt><dd className="mt-1 text-sm font-semibold tabular-nums lg:text-base">{energy === null ? "—" : <>{new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 2 }).format(energy)} <span className="text-xs font-medium">{remainingEnergyWh !== null && remainingEnergyWh >= 1000 ? "кВт·год" : "Вт·год"}</span></>}</dd></div>
          <div className="min-w-0 rounded-xl bg-muted/55 px-2 py-2 lg:px-3 lg:py-2.5"><dt className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock3 aria-hidden="true" className="hidden size-3.5 lg:block" /> Час роботи</dt><dd className="mt-1 text-xs font-semibold lg:text-sm">{runtime !== null ? formatDischargeTime(runtime) : stale ? "Потрібні свіжі дані" : inverterState === 6 ? "Байпас" : batteryPowerW !== null && batteryPowerW >= 0 ? "Без розряду" : "Бракує даних"}{runtime !== null && <span className="mt-0.5 hidden text-[0.65rem] font-normal text-muted-foreground lg:block">за поточної потужності</span>}</dd></div>
        </dl>
      </div>
    </Card>
  );
}
