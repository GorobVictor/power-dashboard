"use client";

import { SlidersHorizontal } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { DetailSummary } from "./detail-summary";
import { powerDirection } from "./flow-status";
import { useDashboardLive } from "./live";
import { MetricValue } from "./metric-value";

const inverterStates: Record<number, string> = {
  0: "Сон", 1: "Очікування", 2: "Заряд", 3: "Розряд", 4: "Резерв", 5: "Оновлення", 6: "Байпас",
};
const workModes: Record<number, string> = { 0: "Самоспоживання", 1: "Ручний режим" };

function mode(value: number | null, labels: Record<number, string>) {
  return value === null ? "—" : labels[value] ?? `Код ${value}`;
}

function EnergyValue({ value }: { value: number | null }) {
  if (value === null || Math.abs(value) < 1000) return <MetricValue value={value} unit="Вт·год" />;
  return <span className="tabular-nums">{new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 2 }).format(value / 1000)} <span className="text-[0.65em] font-medium whitespace-nowrap opacity-80">кВт·год</span></span>;
}

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/55 px-3 py-2.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold wrap-break-word sm:text-base">{children}</dd>
    </div>
  );
}

function DirectionalPower({ value, positive, negative }: { value: number | null; positive: string; negative: string }) {
  return <><MetricValue value={value === null ? null : Math.abs(value)} unit="Вт" /><span className="mt-0.5 block text-xs font-normal text-muted-foreground">{powerDirection(value, positive, negative)}</span></>;
}

export function BatteryPanel({ className }: { className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const { station, connection } = useDashboardLive();
  const loading = !station && connection === "connecting";
  const measurement = station?.kind === "station" ? station.measurement : null;
  const workMode = measurement?.workMode === 1 && measurement.upsEnabled !== false
    ? measurement.upsEnabled ? "UPS" : "Ручний / UPS · невідомо"
    : mode(measurement?.workMode ?? null, workModes);

  return (
    <Card id="station-details" className={cn("min-w-0 gap-0 py-0 lg:pt-4", className, !measurement && !loading && "max-lg:hidden")}>
      <CardHeader className="hidden pb-3 lg:grid">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <span className="grid size-8 place-items-center rounded-lg bg-success-surface text-success">
            <SlidersHorizontal aria-hidden="true" className="size-4" />
          </span>
          Деталі станції
        </h2>
      </CardHeader>
      {loading ? <div aria-hidden="true" className="flex min-h-12 items-center justify-between px-4 py-3 sm:px-5 lg:hidden"><Skeleton className="h-4 w-36" /><Skeleton className="size-4" /></div> : <DetailSummary expanded={expanded} controls={contentId} onToggle={() => setExpanded((value) => !value)}>
        <SlidersHorizontal aria-hidden="true" className="size-4 text-success" /> Деталі станції
      </DetailSummary>}
      <div id={contentId} className={cn(
        "grid lg:visible lg:grid-rows-[1fr] max-lg:motion-safe:transition-[grid-template-rows,visibility] max-lg:motion-safe:duration-200",
        expanded ? "grid-rows-[1fr]" : "invisible grid-rows-[0fr]",
      )}>
        <div className="relative min-h-0 overflow-hidden">
          {!measurement ? (
            <CardContent className="pb-4">
              <p className="grid min-h-20 place-items-center rounded-lg border border-dashed p-3 text-center text-sm text-muted-foreground">
                Показники з’являться після першого виміру станції.
              </p>
            </CardContent>
          ) : (
            <CardContent className="space-y-4 border-t py-4 lg:border-t-0 lg:pt-0">
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Metric label="Залишок енергії"><EnergyValue value={measurement.remainingEnergyWh} /></Metric>
                <Metric label="Потужність батареї"><DirectionalPower value={measurement.batteryPowerW} positive="Заряд" negative="Розряд" /></Metric>
                <Metric label="Обмін з мережею"><DirectionalPower value={measurement.gridPowerW} positive="Від станції" negative="До станції" /></Metric>
                <Metric label="Потужність інвертора (AC)"><DirectionalPower value={measurement.acOutputPowerW} positive="Віддача" negative="Споживання" /></Metric>
                <Metric label="Стан інвертора">{mode(measurement.inverterState, inverterStates)}</Metric>
                <Metric label="Режим роботи">{workMode}</Metric>
              </dl>
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Лічильники енергії</h3>
                <div className="rounded-lg border px-2.5">
                  <table className="w-full table-fixed text-left text-xs sm:text-sm">
                    <thead className="text-muted-foreground">
                      <tr>
                        <th scope="col" className="py-2 font-medium">Період</th>
                        <th scope="col" className="py-2 text-right font-medium">Заряд</th>
                        <th scope="col" className="py-2 text-right font-medium">Розряд</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { label: "За добу", input: measurement.dailyEnergyInWh, output: measurement.dailyEnergyOutWh },
                        { label: "За місяць", input: measurement.monthlyEnergyInWh, output: measurement.monthlyEnergyOutWh },
                        { label: "За весь час", input: measurement.totalEnergyInWh, output: measurement.totalEnergyOutWh },
                      ].map(({ label, input, output }) => (
                        <tr key={label} className="border-t">
                          <th scope="row" className="py-2 font-medium">{label}</th>
                          <td className="py-2 pl-2 text-right wrap-anywhere"><EnergyValue value={input} /></td>
                          <td className="py-2 pl-2 text-right wrap-anywhere"><EnergyValue value={output} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </CardContent>
          )}
        </div>
      </div>
    </Card>
  );
}
