"use client";

import { Activity } from "lucide-react";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { shiftTelemetryDate, telemetryPeriods, type TelemetryHistory, type TelemetrySample, type TelemetrySelection } from "@/lib/telemetry-history";
import { cn } from "@/lib/utils";
import { isScheduleDate, timeZone } from "@/server/outages/schedules";
import { useDashboardLive } from "./live";
import { mobilePanelClassName, Timestamp } from "./panel";

type Series = { key: Exclude<keyof TelemetrySample, "time">; label: string; color: string };

const charge: Series[] = [{ key: "socPct", label: "Заряд", color: "var(--chart-charge)" }];
const scheduleCharge: Series[] = [{ key: "socPct", label: "Заряд", color: "var(--schedule-charge)" }];
const power: Series[] = [
  { key: "batteryPowerW", label: "Батарея", color: "var(--chart-charge)" },
  { key: "gridPowerW", label: "Мережа", color: "var(--chart-grid)" },
  { key: "backupLoadPowerW", label: "Резерв", color: "var(--chart-backup)" },
];
const timeFormat = new Intl.DateTimeFormat("uk-UA", { timeZone, hour: "2-digit", minute: "2-digit" });
const dateFormat = new Intl.DateTimeFormat("uk-UA", { timeZone, day: "2-digit", month: "2-digit" });
const fullDateFormat = new Intl.DateTimeFormat("uk-UA", { timeZone, dateStyle: "short" });
const number = new Intl.NumberFormat("uk-UA");
const presets = [
  { period: "today", label: "Сьогодні" },
  { period: "yesterday", label: "Вчора" },
  ...(["1h", "6h", "7d"] as const).map((period) => ({ period, label: telemetryPeriods[period].label })),
] as const;
type PeriodFilter = { period: "today" } | { period: "yesterday" } | TelemetrySelection;

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

type ChartOverlay = { background: ReactNode; now: number; emptyMessage: string };

export function ScheduleChargeChart({ history, overlay }: { history: TelemetryHistory; overlay: ChartOverlay }) {
  return <HistoryChart title="Заряд і розряд" unit="%" history={history} calendar series={scheduleCharge} overlay={overlay} />;
}

function HistoryChart({ title, unit, history, calendar, series, overlay }: {
  title: string; unit: string; history: TelemetryHistory; calendar: boolean; series: Series[];
  overlay?: ChartOverlay;
}) {
  const label = useId();
  const instructions = useId();
  const [selection, setSelection] = useState<number>();
  const { start, end, bucket, samples } = history;
  const duration = end - start;
  const days = Math.round(duration / 86_400_000);
  const tickFractions = days === 2 ? [0, 1] : days === 3 || days === 4 ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1];
  const axisFormat = days > 1 ? dateFormat : timeFormat;
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
  const shown = active ?? available.at(-1);

  function selectFraction(fraction: number) {
    if (available.length === 0) return;
    const time = start + fraction * duration;
    const nearest = available.reduce((closest, sample) =>
      Math.abs(sample.time - time) < Math.abs(closest.time - time) ? sample : closest,
    );
    setSelection(Math.floor(nearest.time / bucket));
  }

  return (
    <figure className="min-w-0">
      <figcaption id={label} className="mb-2 flex items-baseline justify-between gap-2 text-sm font-semibold">
        <span>{title} <span className="text-xs font-normal text-muted-foreground">{unit}</span></span>
        {overlay && (
          <span className="flex items-center gap-1.5 text-[0.6875rem] font-normal text-muted-foreground">
            <span aria-hidden="true" className="h-2.5 border-l border-dashed border-foreground/70" />Зараз
          </span>
        )}
      </figcaption>
      {available.length === 0 && !overlay ? (
        <div className="grid h-43 place-items-center rounded-lg border border-dashed text-center text-sm text-muted-foreground sm:h-52 lg:h-44 xl:h-52">
          Немає показників за цей період
        </div>
      ) : (
        <>
          <p id={instructions} className="sr-only">Натисніть стрілку ліворуч або праворуч, щоб переглянути виміри.</p>
          <div className={cn("grid min-w-0 gap-x-1.5", overlay ? "grid-cols-[1.55rem_minmax(0,1fr)]" : "grid-cols-[2.5rem_minmax(0,1fr)] sm:grid-cols-[3.15rem_minmax(0,1fr)]")}>
            <div aria-hidden="true" className="relative text-right text-[0.625rem] text-muted-foreground tabular-nums sm:text-xs">
              {plot.ticks.map((value) => (
                <span key={value} className="absolute right-0 -translate-y-1/2" style={{ top: `${plot.y(value) / 2}%` }}>{number.format(value)}</span>
              ))}
            </div>
            <div
              role="group" tabIndex={available.length ? 0 : undefined} aria-labelledby={label} aria-describedby={available.length ? instructions : undefined}
              className={cn("relative rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                overlay ? "h-28 sm:h-32 xl:h-36" : "h-34 sm:h-40 lg:h-32 xl:h-40")}
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
                if (!available.length) return;
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
              {overlay?.background}
              <svg aria-hidden="true" className="pointer-events-none relative h-full w-full overflow-visible" viewBox="0 0 1000 200" preserveAspectRatio="none">
                {plot.ticks.map((value) => (
                  <path key={value} d={`M0 ${plot.y(value)}H1000`} stroke="var(--border)" vectorEffect="non-scaling-stroke" />
                ))}
                {series.map(({ key, color }, index) => (
                  <path key={key} d={plot.paths[index]} fill="none" stroke={color} strokeWidth={1.7}
                    strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                ))}
              </svg>
              {overlay && overlay.now >= start && overlay.now < end && (
                <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 border-l border-dashed border-foreground/70"
                  style={{ left: `${plot.x(overlay.now) / 10}%` }} />
              )}
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
                <span key={fraction} className={tickFractions.length === 5 && index % 2 ? "hidden sm:inline" : undefined}>
                  {calendar && days === 1 && fraction === 1 ? "24:00"
                    : axisFormat.format(fraction === 1 && calendar ? end - 1 : start + duration * fraction)}
                </span>
              ))}
            </div>
          </div>
          {overlay ? shown?.socPct != null ? (
            <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground tabular-nums" aria-live="polite">
              <strong className="font-semibold text-[var(--schedule-charge)]">{number.format(shown.socPct)}%</strong>
              <time dateTime={new Date(shown.time).toISOString()}>{timeFormat.format(shown.time)}</time>
              {shown.batteryPowerW !== null && shown.batteryPowerW !== 0 && (
                <span>{shown.batteryPowerW > 0 ? "Заряджається" : "Розряджається"} · {number.format(Math.abs(shown.batteryPowerW))} Вт</span>
              )}
            </p>
          ) : (
            <p role="status" className="mt-1.5 text-xs text-muted-foreground">{overlay.emptyMessage}</p>
          ) : (
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
              <p className="min-h-4">
                {active && <Timestamp value={new Date(active.time)} />}
              </p>
            </div>
          )}
        </>
      )}
    </figure>
  );
}

export function TelemetryPanel() {
  const [filter, setFilter] = useState<PeriodFilter>({ period: "today" });
  const [datesOpen, setDatesOpen] = useState(false);
  const [dateError, setDateError] = useState(false);
  const [chart, setChart] = useState<"charge" | "power">("charge");
  const datesId = useId();
  const { station, telemetry, connection, historySupported, revision, request, today } = useDashboardLive();
  const configured = station?.kind === "station";
  const selection = useMemo<TelemetrySelection | null>(() => {
    if (filter.period === "today" || filter.period === "yesterday") {
      if (!today) return null;
      const date = filter.period === "today" ? today : shiftTelemetryDate(today, -1);
      return { period: "dates", from: date, to: date };
    }
    return filter;
  }, [filter, today]);

  useEffect(() => {
    if (configured && connection === "connected" && historySupported && selection) {
      request({ type: "telemetry", ...selection });
    }
  }, [configured, connection, historySupported, selection, request, revision]);

  const response = telemetry && telemetry.period === selection?.period &&
    (telemetry.period !== "dates" || (selection.period === "dates" && telemetry.from === selection.from && telemetry.to === selection.to))
    ? telemetry : undefined;
  const history = response?.value;
  const calendar = selection?.period === "dates";
  const rangeLabel = filter.period === "dates" && fullDateFormat.formatRange(new Date(filter.from), new Date(filter.to));
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
          <p className="mt-0.5 text-xs text-muted-foreground">
            {rangeLabel && `${rangeLabel} · `}Київський час
          </p>
        </div>
        <div role="group" aria-label="Період вимірів" className="grid w-full grid-cols-3 gap-0.5 rounded-lg border bg-background p-0.5 min-[480px]:w-auto min-[480px]:grid-cols-6">
          {presets.map(({ period, label }) => (
            <button type="button" key={period} aria-pressed={filter.period === period} onClick={() => {
              setFilter({ period });
              setDatesOpen(false);
              setDateError(false);
            }}
              className={cn(
                "min-h-9 cursor-pointer rounded-md px-2 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-2.5",
                filter.period === period ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}>
              {label}
            </button>
          ))}
          <button type="button" aria-expanded={datesOpen} aria-controls={datesId} onClick={() => {
            setDatesOpen(!datesOpen);
            setDateError(false);
          }} className={cn(
            "min-h-9 cursor-pointer rounded-md px-2 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-2.5",
            filter.period === "dates" || datesOpen ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}>
            Дати
          </button>
        </div>
      </CardHeader>
      <CardContent className="min-w-0 space-y-3">
        {datesOpen && (
          <form id={datesId} className="space-y-2" onChange={() => setDateError(false)} onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const from = data.get("from");
            const to = data.get("to");
            if (!isScheduleDate(from) || !isScheduleDate(to) || from > to) {
              setDateError(true);
              return;
            }
            setFilter({ period: "dates", from, to });
          }}>
            <div className="grid grid-cols-1 items-end gap-2 min-[400px]:grid-cols-2 min-[480px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <label className="grid min-w-0 gap-1 text-xs font-medium text-muted-foreground">
                Початкова дата
                <Input type="date" name="from" defaultValue={calendar ? selection.from : today} max={today || undefined} required />
              </label>
              <label className="grid min-w-0 gap-1 text-xs font-medium text-muted-foreground">
                Кінцева дата
                <Input type="date" name="to" defaultValue={calendar ? selection.to : today} max={today || undefined} required />
              </label>
              <Button type="submit" variant="outline" className="min-[400px]:col-span-2 min-[480px]:col-span-1">Показати</Button>
            </div>
            {dateError && <p role="alert" className="text-xs text-muted-foreground">Кінцева дата має бути не раніше початкової.</p>}
          </form>
        )}
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
        {configured && history && response ? (
          <div className="dashboard-enter lg:space-y-3.5 xl:grid xl:grid-cols-2 xl:gap-3.5 xl:space-y-0"
            key={response.period === "dates" ? `${response.from}-${response.to}` : response.period}>
            <div className={chart === "charge" ? "dashboard-mobile-enter" : "hidden lg:block"}>
              <HistoryChart title="Рівень заряду" unit="%" history={history} calendar={calendar} series={charge} />
            </div>
            <div className={cn("lg:border-t lg:pt-3.5 xl:border-t-0 xl:border-l xl:pt-0 xl:pl-3.5", chart === "power" ? "dashboard-mobile-enter" : "hidden lg:block")}>
              <HistoryChart title="Потужність" unit="Вт" history={history} calendar={calendar} series={power} />
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
