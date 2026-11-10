"use client";

import { Activity } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { defaultTelemetryPeriod, telemetryPeriods, type TelemetryHistory, type TelemetryPeriod, type TelemetrySample } from "@/lib/telemetry-history";
import { timeZone } from "@/server/outages/schedules";
import { useDashboardLive } from "./live";
import { mobilePanelClassName, Timestamp } from "./panel";

type Series = { key: Exclude<keyof TelemetrySample, "time">; label: string; color: string };

const charge: Series[] = [{ key: "socPct", label: "Заряд", color: "var(--chart-charge)" }];
const power: Series[] = [
  { key: "batteryPowerW", label: "Батарея", color: "var(--chart-charge)" },
  { key: "gridPowerW", label: "Мережа", color: "var(--chart-grid)" },
  { key: "backupLoadPowerW", label: "Резерв", color: "var(--chart-backup)" },
];
const timeFormat = new Intl.DateTimeFormat("uk-UA", { timeZone, hour: "2-digit", minute: "2-digit" });
const dateFormat = new Intl.DateTimeFormat("uk-UA", { timeZone, day: "2-digit", month: "2-digit" });
const number = new Intl.NumberFormat("uk-UA");
const tickFractions = [0, 0.25, 0.5, 0.75, 1];

function powerTicks(samples: TelemetrySample[]) {
  const values = samples.flatMap((sample) => power.map(({ key }) => sample[key] ?? 0));
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  if (!min && !max) return [100, 0, -100];
  const step = 10 ** Math.floor(Math.log10((max - min) / 4));
  const interval = [1, 2, 2.5, 5, 10].map((scale) => scale * step).find((size) => size >= (max - min) / 4) ?? 10 * step;
  const bottom = Math.floor(min / interval);
  const top = Math.ceil(max / interval);
  return Array.from({ length: top - bottom + 1 }, (_, index) => (top - index) * interval);
}

function chartPath(
  samples: TelemetrySample[], key: Series["key"], bucket: number,
  x: (time: number) => number, y: (value: number) => number,
) {
  let previous = -Infinity;
  let path = "";
  for (const sample of samples) {
    const value = sample[key];
    if (value === null) continue;
    const slot = Math.floor(sample.time / bucket);
    const point = `${x(sample.time).toFixed(2)} ${y(value).toFixed(2)}`;
    path += slot === previous + 1 ? `L${point}` : `M${point}h.01`;
    previous = slot;
  }
  return path;
}

function HistoryChart({ title, unit, history, period, series }: {
  title: string; unit: string; history: TelemetryHistory; period: TelemetryPeriod; series: Series[];
}) {
  const label = useId();
  const instructions = useId();
  const [selection, setSelection] = useState<number>();
  const { duration, bucket } = telemetryPeriods[period];
  const { end, samples } = history;
  const start = end - duration;
  const plot = useMemo(() => {
    const ticks = unit === "%" ? [100, 75, 50, 25, 0] : powerTicks(samples);
    const top = ticks[0];
    const range = top - ticks[ticks.length - 1];
    const x = (time: number) => (time - start) / duration * 1000;
    const y = (value: number) => (top - value) / range * 200;
    return {
      x, y, ticks,
      paths: series.map(({ key }) => chartPath(samples, key, bucket, x, y)),
      available: samples.filter((sample) => series.some(({ key }) => sample[key] !== null)),
    };
  }, [unit, samples, start, duration, series, bucket]);
  const { available } = plot;
  const active = selection === undefined ? undefined : available.find(
    (sample) => Math.floor(sample.time / bucket) === selection,
  );

  function selectFraction(fraction: number) {
    const time = start + fraction * duration;
    const nearest = available.reduce((closest, sample) =>
      Math.abs(sample.time - time) < Math.abs(closest.time - time) ? sample : closest,
    );
    setSelection(Math.floor(nearest.time / bucket));
  }

  return (
    <figure className="min-w-0">
      <figcaption id={label} className="mb-2 flex items-baseline gap-2 text-sm font-semibold">
        {title}<span className="text-xs font-normal text-muted-foreground">{unit}</span>
      </figcaption>
      {available.length === 0 ? (
        <div className="grid h-43 place-items-center rounded-lg border border-dashed text-center text-sm text-muted-foreground sm:h-52 lg:h-44 xl:h-52">
          Немає показників за цей період
        </div>
      ) : (
        <>
          <p id={instructions} className="sr-only">Натисніть стрілку ліворуч або праворуч, щоб переглянути виміри.</p>
          <div className="grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)] gap-x-1.5 sm:grid-cols-[3.15rem_minmax(0,1fr)]">
            <div aria-hidden="true" className="relative text-right text-[0.625rem] text-muted-foreground tabular-nums sm:text-xs">
              {plot.ticks.map((value) => (
                <span key={value} className="absolute right-0 -translate-y-1/2" style={{ top: `${plot.y(value) / 2}%` }}>{number.format(value)}</span>
              ))}
            </div>
            <div
              role="group" tabIndex={0} aria-labelledby={label} aria-describedby={instructions}
              className="relative h-34 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-40 lg:h-32 xl:h-40"
              onPointerMove={(event) => {
                if (event.pointerType !== "mouse") return;
                const bounds = event.currentTarget.getBoundingClientRect();
                selectFraction((event.clientX - bounds.left) / bounds.width);
              }}
              onPointerDown={(event) => {
                if (event.pointerType === "mouse") return;
                const bounds = event.currentTarget.getBoundingClientRect();
                selectFraction((event.clientX - bounds.left) / bounds.width);
              }}
              onPointerLeave={(event) => { if (event.pointerType === "mouse") setSelection(undefined); }}
              onBlur={() => setSelection(undefined)}
              onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(event.key)) return;
                event.preventDefault();
                if (event.key === "Escape") {
                  setSelection(undefined);
                  return;
                }
                const index = active ? available.indexOf(active) : available.length;
                const next = event.key === "Home" ? 0 : event.key === "End" ? available.length - 1
                  : Math.min(available.length - 1, Math.max(0, index + (event.key === "ArrowLeft" ? -1 : 1)));
                setSelection(Math.floor(available[next].time / bucket));
              }}
            >
              <svg aria-hidden="true" className="h-full w-full overflow-visible" viewBox="0 0 1000 200" preserveAspectRatio="none">
                {plot.ticks.map((value) => (
                  <path key={value} d={`M0 ${plot.y(value)}H1000`} stroke="var(--border)" vectorEffect="non-scaling-stroke" />
                ))}
                {series.map(({ key, color }, index) => (
                  <path key={key} d={plot.paths[index]} fill="none" stroke={color} strokeWidth={1.7}
                    strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                ))}
              </svg>
              {active && (
                <div className="pointer-events-none absolute inset-y-0 border-l border-dashed border-muted-foreground"
                  style={{ left: `${plot.x(active.time) / 10}%` }} aria-hidden="true">
                  {series.map(({ key, color }) => {
                    const value = active[key];
                    return value === null ? null : <span key={key} className="absolute size-2 -translate-1/2 rounded-full ring-2 ring-card"
                      style={{ top: `${plot.y(value) / 2}%`, background: color }} />;
                  })}
                </div>
              )}
            </div>
            <div aria-hidden="true" className="col-start-2 mt-1.5 flex justify-between gap-1 text-[0.625rem] text-muted-foreground tabular-nums sm:text-xs">
              {tickFractions.map((fraction, index) => (
                <span key={fraction} className={index % 2 ? "hidden sm:inline" : undefined}>
                  {(period === "7d" ? dateFormat : timeFormat).format(start + duration * fraction)}
                </span>
              ))}
            </div>
          </div>
          <div className="mt-2 space-y-0.5 text-xs text-muted-foreground" aria-live="polite">
            <ul className="flex flex-wrap gap-x-3 gap-y-1">
              {series.map(({ key, color, label }) => (
                <li key={key} className="flex items-center gap-1.5">
                  <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: color }} />
                  {label}
                  <span className="min-w-[4ch] font-semibold text-foreground tabular-nums">
                    {active ? active[key] === null ? "—" : number.format(active[key]) : null}
                  </span>
                </li>
              ))}
            </ul>
            <p className="min-h-4">{active && <Timestamp value={new Date(active.time)} />}</p>
          </div>
        </>
      )}
    </figure>
  );
}

export function TelemetryPanel() {
  const [period, setPeriod] = useState<TelemetryPeriod>(defaultTelemetryPeriod);
  const [chart, setChart] = useState<"charge" | "power">("charge");
  const { station, telemetry, connection, historySupported, revision, request } = useDashboardLive();
  const configured = station?.kind === "station";

  useEffect(() => {
    if (configured && connection === "connected" && historySupported) request({ type: "telemetry", period });
  }, [configured, connection, historySupported, period, request, revision]);

  const response = telemetry?.period === period ? telemetry : undefined;
  const pending = configured && connection === "connected" && historySupported && !response;
  const history = pending ? telemetry?.value : response?.value;
  const message = station?.kind === "unconfigured" || station?.kind === "missing" ? "Історія з’явиться після налаштування станції."
    : connection === "disconnected" ? "Очікуємо на відновлення з’єднання."
    : connection === "connected" && !historySupported ? "Щоб завантажити історію, перезапустіть вебсервер."
    : response?.value === null ? "Не вдалося завантажити виміри за цей період."
    : "Завантажуємо виміри…";

  return (
    <Card className={cn("gap-3 py-4", mobilePanelClassName)}>
      <CardHeader className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2.5">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight sm:text-lg">
            <span className="grid size-8 place-items-center rounded-lg bg-success-surface text-success">
              <Activity aria-hidden="true" className="size-4" />
            </span>
            Історія вимірів
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground" role="status">
            {pending && history ? "Завантажуємо період…" : "Київський час"}
          </p>
        </div>
        <div role="group" aria-label="Період вимірів" className="grid w-full grid-cols-4 gap-0.5 rounded-lg border bg-background p-0.5 min-[480px]:w-auto">
          {(Object.keys(telemetryPeriods) as TelemetryPeriod[]).map((key) => (
            <button type="button" key={key} onClick={() => setPeriod(key)} aria-pressed={period === key}
              className={cn(
                "min-h-9 cursor-pointer rounded-md px-2 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-2.5",
                period === key ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}>
              {telemetryPeriods[key].label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="min-w-0 space-y-3">
        {configured && (
          <div role="group" aria-label="Графік вимірів" className="grid grid-cols-2 gap-1 lg:hidden">
            {([{ key: "charge", label: "Заряд" }, { key: "power", label: "Потужність" }] as const).map(({ key, label }) => (
              <button type="button" key={key} onClick={() => setChart(key)} aria-pressed={chart === key}
                className={cn(
                  "min-h-9 cursor-pointer rounded-md border px-2 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  chart === key ? "border-transparent bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted",
                )}>
                {label}
              </button>
            ))}
          </div>
        )}
        {configured && history && telemetry ? (
          <div className="dashboard-enter lg:space-y-3.5 xl:grid xl:grid-cols-2 xl:gap-3.5 xl:space-y-0" key={telemetry.period}>
            <div className={chart === "charge" ? "dashboard-mobile-enter" : "hidden lg:block"}>
              <HistoryChart title="Рівень заряду" unit="%" history={history} period={telemetry.period} series={charge} />
            </div>
            <div className={cn("lg:border-t lg:pt-3.5 xl:border-t-0 xl:border-l xl:pt-0 xl:pl-3.5", chart === "power" ? "dashboard-mobile-enter" : "hidden lg:block")}>
              <HistoryChart title="Потужність" unit="Вт" history={history} period={telemetry.period} series={power} />
            </div>
          </div>
        ) : (
          <p role="status" className="grid min-h-36 place-items-center rounded-lg border border-dashed p-3 text-center text-sm text-muted-foreground">
            {message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
