"use client";

import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CardCarousel } from "./card-carousel";
import { useDashboardLive } from "./live";
import { PanelMessage, PanelSkeleton, StatusBadge, Timestamp } from "./panel";

const numberFormat = new Intl.NumberFormat("uk-UA");
const signedNumberFormat = new Intl.NumberFormat("uk-UA", { signDisplay: "exceptZero" });
const inverterStates: Record<number, string> = {
  0: "Сон", 1: "Очікування", 2: "Заряд", 3: "Розряд", 4: "Резерв", 5: "Оновлення", 6: "Байпас",
};
const workModes: Record<number, string> = { 0: "Самоспоживання", 1: "Ручний режим" };

function metric(value: number | null, unit: string, signed = false) {
  if (value === null) return <><span aria-hidden="true">—</span><span className="sr-only">Немає даних</span></>;
  const format = signed ? signedNumberFormat : numberFormat;
  return <>{format.format(value).replaceAll("\u00a0", " ")}{" "}<span className="text-[0.65em] font-medium whitespace-nowrap text-muted-foreground">{unit}</span></>;
}

function mode(value: number | null, labels: Record<number, string>) {
  return value === null ? "—" : labels[value] ?? `Код ${value}`;
}

function Metric({ label, value, description }: { label: string; value: ReactNode; description?: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/55 p-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-base font-semibold break-words tabular-nums sm:text-lg">{value}</dd>
      {description && <dd className="mt-0.5 text-xs text-muted-foreground">{description}</dd>}
    </div>
  );
}

export function BatteryPanel() {
  const { station: latest, stationStale: stale, connection } = useDashboardLive();
  if (!latest) {
    return connection === "disconnected"
      ? <PanelMessage title="Показники тимчасово недоступні">Очікуємо на відновлення з’єднання.</PanelMessage>
      : <PanelSkeleton label="Завантаження показників акумулятора" />;
  }
  if (latest.kind === "unconfigured") {
    return <PanelMessage title="Станцію не налаштовано">Додайте внутрішній ID станції до конфігурації дашборда.</PanelMessage>;
  }

  if (latest.kind === "missing") {
    return <PanelMessage title="Станцію не знайдено">Перевірте, чи зареєстровано станцію з налаштованим ID.</PanelMessage>;
  }

  const { station, measurement } = latest;
  const overview = (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="min-w-0 text-lg break-words">{station.name}</CardTitle>
          {measurement ? (
            <StatusBadge tone={stale ? "warning" : "success"}>
              {stale ? "Застарілі показники" : "Актуальні показники"}
            </StatusBadge>
          ) : <StatusBadge tone="muted">Немає вимірів</StatusBadge>}
        </div>
        <CardDescription className="break-words">{station.model}</CardDescription>
      </CardHeader>
      <CardContent>
        {measurement ? (
          <div className="space-y-4">
            <div className="rounded-lg bg-success-surface p-4">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-success">Рівень заряду</span>
                <span className="text-3xl font-bold tracking-tight text-success tabular-nums">
                  {metric(measurement.socPct, "%")}
                </span>
              </div>
              {measurement.socPct !== null && (
                <progress aria-label="Рівень заряду" value={measurement.socPct} max={100} className="charge-progress" />
              )}
            </div>
            <dl className="grid grid-cols-2 gap-2.5">
              <Metric label="Залишок енергії" value={metric(measurement.remainingEnergyWh, "Вт·год")} />
              <Metric
                label="Потужність батареї"
                value={metric(measurement.batteryPowerW, "Вт", true)}
                description={measurement.batteryPowerW === null ? undefined :
                  measurement.batteryPowerW > 0 ? "Заряд" : measurement.batteryPowerW < 0 ? "Розряд" : "У спокої"}
              />
            </dl>
            <p className="text-xs text-muted-foreground">
              Останній вимір <Timestamp value={measurement.measuredAt} /> за Києвом.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Очікуємо на перший успішний вимір зі станції.</p>
        )}
      </CardContent>
    </Card>
  );
  if (!measurement) return overview;

  return (
    <CardCarousel label="Картки акумулятора" slides={[
      { id: "overview", content: overview },
      {
        id: "power",
        content: (
          <Card>
            <CardHeader>
              <CardTitle>Потужність і режим</CardTitle>
              <CardDescription>Для мережі й AC-виходу «+» означає віддачу, «−» — споживання.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-2.5">
                <Metric label="Потужність мережі" value={metric(measurement.gridPowerW, "Вт", true)} />
                <Metric label="Потужність AC-виходу" value={metric(measurement.acOutputPowerW, "Вт", true)} />
                <Metric label="Резервне навантаження" value={metric(measurement.backupLoadPowerW, "Вт")} />
                <Metric label="Стан інвертора" value={mode(measurement.inverterState, inverterStates)} />
                <Metric label="Режим роботи" value={mode(measurement.workMode, workModes)} />
              </dl>
            </CardContent>
          </Card>
        ),
      },
      {
        id: "energy",
        content: (
          <Card>
            <CardHeader>
              <CardTitle>Лічильники енергії</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-3 min-[500px]:grid-cols-3">
                {[
                  { label: "За добу", input: measurement.dailyEnergyInWh, output: measurement.dailyEnergyOutWh },
                  { label: "За місяць", input: measurement.monthlyEnergyInWh, output: measurement.monthlyEnergyOutWh },
                  { label: "За весь час", input: measurement.totalEnergyInWh, output: measurement.totalEnergyOutWh },
                ].map(({ label, input, output }) => (
                  <div key={label}>
                    <h4 className="mb-1.5 text-sm font-semibold">{label}</h4>
                    <dl className="grid grid-cols-2 gap-1.5 min-[500px]:grid-cols-1">
                      <Metric label="Заряд" value={metric(input, "Вт·год")} />
                      <Metric label="Розряд" value={metric(output, "Вт·год")} />
                    </dl>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ),
      },
    ]} />
  );
}
