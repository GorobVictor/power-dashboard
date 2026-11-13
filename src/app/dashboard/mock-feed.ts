import type { DashboardMessage, DashboardRequest, DashboardSchedule } from "@/lib/dashboard-feed";
import { shiftTelemetryDate, telemetryWindow, type TelemetrySample } from "@/lib/telemetry-history";
import { kyivDate } from "@/server/outages/schedules";

const minute = 60_000;
const hour = 60 * minute;
const queues = ["4.1", "4.2"];

function sample(time: number) {
  const cycle = time / (3 * hour);
  const backupLoadPowerW = Math.round(380 + 110 * Math.sin(time / (8 * minute)));
  const charging = Math.sin(cycle) > 0.4;
  return {
    time,
    socPct: Math.round(67 + 19 * Math.cos(cycle)),
    backupLoadPowerW,
    batteryPowerW: charging ? 720 : -backupLoadPowerW,
    gridPowerW: charging ? -(backupLoadPowerW + 780) : 0,
  };
}

function schedule(date: string, queue: string, observedAt: number, start: number): DashboardSchedule {
  return {
    date,
    queue,
    observedAt: new Date(observedAt).toISOString(),
    status: "ScheduleApplies",
    hours: Array.from({ length: 24 }, (_, index) => index === 1 ? 2 : index === 4 || (index >= start && index < start + 3) ? 1 : 0),
    possible: Array.from({ length: 24 }, (_, index) => index === start + 8 ? 1 : 0),
    publishedSchedule: null,
  };
}

export function mockStation(now: number): DashboardMessage {
  const { time, ...metrics } = sample(now);
  return {
    type: "station",
    value: {
      kind: "station",
      station: { id: "demo", name: "Демо-станція Marstek", model: "Venus E 3.0" },
      staleAfterMs: 2 * minute,
      measurement: {
        ...metrics,
        measuredAt: new Date(time).toISOString(),
        remainingEnergyWh: metrics.socPct * 51,
        acOutputPowerW: metrics.gridPowerW + metrics.backupLoadPowerW,
        inverterState: metrics.batteryPowerW > 0 ? 2 : 3,
        workMode: 1,
        upsEnabled: true,
        dailyEnergyInWh: 1460,
        dailyEnergyOutWh: 970,
        monthlyEnergyInWh: 18400,
        monthlyEnergyOutWh: 16200,
        totalEnergyInWh: 184200,
        totalEnergyOutWh: 169700,
      },
    },
  };
}

export function mockOutages(now: number, today: string, schedulesChanged: boolean): DashboardMessage {
  return {
    type: "outages",
    schedulesChanged,
    value: {
      schedules: [today, shiftTelemetryDate(today, 1)].flatMap((date, day) =>
        queues.map((queue, index) => schedule(date, queue, now, 8 + 2 * index + day))),
      lastSuccessfulPollAt: new Date(now).toISOString(),
      staleAfterMs: 2 * minute,
    },
  };
}

export function mockHistory(request: DashboardRequest, now: number): DashboardMessage {
  const oldest = now - 7 * 24 * hour;
  if (request.type === "outageHistory") {
    const first = Math.max(oldest, telemetryWindow({ from: request.date, to: request.date }).start);
    if (first > now || request.date < kyivDate(new Date(oldest))) return { ...request, value: [] };
    const value = queues.flatMap((queue, index) => {
      if (request.queue !== null && queue !== request.queue) return [];
      const updated = Math.min(now, first + hour);
      const start = 8 + 2 * index;
      const current = schedule(request.date, queue, updated, start);
      return updated > first ? [schedule(request.date, queue, first, start + 1), current] : [current];
    }).sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    return { ...request, value };
  }

  const period = request.type === "chargeHistory" ? { from: request.date, to: request.date }
    : request.period === "dates" ? request : request.period;
  const window = telemetryWindow(period, now);
  const samples: TelemetrySample[] = [];
  for (let time = Math.max(window.start, oldest); time < Math.min(window.end, now); time += window.bucket) {
    samples.push(sample(time));
  }
  return { ...request, value: { ...window, samples } };
}
