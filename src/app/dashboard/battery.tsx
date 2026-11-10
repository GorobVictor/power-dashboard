"use client";

import { SlidersHorizontal } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { DetailSummary } from "./detail-summary";
import { useDashboardLive } from "./live";
import { MetricValue } from "./metric-value";

const inverterStates: Record<number, string> = {
  0: "Сон", 1: "Очікування", 2: "Заряд", 3: "Розряд", 4: "Резерв", 5: "Оновлення", 6: "Байпас",
};
const workModes: Record<number, string> = { 0: "Самоспоживання", 1: "Ручний режим" };

function mode(value: number | null, labels: Record<number, string>) {
  return value === null ? "—" : labels[value] ?? `Код ${value}`;
}

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/55 px-3 py-2.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold wrap-break-word sm:text-base">{children}</dd>
    </div>
  );
}

export function BatteryPanel({ className }: { className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const { station } = useDashboardLive();
  const measurement = station?.kind === "station" ? station.measurement : null;

  return (
    <Card id="station-details" className={cn("min-w-0 gap-0 py-0 lg:pt-4", className, !measurement && "max-lg:hidden")}>
      <CardHeader className="hidden pb-3 lg:grid">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <span className="grid size-8 place-items-center rounded-lg bg-success-surface text-success">
            <SlidersHorizontal aria-hidden="true" className="size-4" />
          </span>
          Деталі станції
        </h2>
      </CardHeader>
      <DetailSummary expanded={expanded} controls={contentId} onToggle={() => setExpanded((value) => !value)}>
        <SlidersHorizontal aria-hidden="true" className="size-4 text-success" /> Деталі станції
      </DetailSummary>
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
                <Metric label="Залишок енергії"><MetricValue value={measurement.remainingEnergyWh} unit="Вт·год" /></Metric>
                <Metric label="Потужність батареї"><MetricValue value={measurement.batteryPowerW} unit="Вт" signed /></Metric>
                <Metric label="Потужність мережі"><MetricValue value={measurement.gridPowerW} unit="Вт" signed /></Metric>
                <Metric label="Потужність AC-виходу"><MetricValue value={measurement.acOutputPowerW} unit="Вт" signed /></Metric>
                <Metric label="Стан інвертора">{mode(measurement.inverterState, inverterStates)}</Metric>
                <Metric label="Режим роботи">{mode(measurement.workMode, workModes)}</Metric>
              </dl>
              <p className="text-xs text-muted-foreground">Для мережі й AC-виходу «+» означає віддачу, «−» — споживання.</p>
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
                          <td className="py-2 pl-2 text-right wrap-anywhere"><MetricValue value={input} unit="Вт·год" /></td>
                          <td className="py-2 pl-2 text-right wrap-anywhere"><MetricValue value={output} unit="Вт·год" /></td>
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
