import type { ScheduleVersion } from "../server/outages/schedules.ts";
import type { SerializedMeasurement, Station } from "../server/stations/types.ts";
import type { TelemetryHistory, TelemetrySelection } from "./telemetry-history.ts";

export const dashboardSocketPath = "/ws/dashboard";
export const dashboardSessionExpired = 4401;

export type DashboardStation =
  | { kind: "station"; station: Station; measurement: SerializedMeasurement | null; staleAfterMs: number }
  | { kind: "unconfigured" }
  | { kind: "missing" };

export type DashboardSchedule = Omit<ScheduleVersion, "observedAt"> & { observedAt: string };

export type DashboardOutages = {
  schedules: DashboardSchedule[];
  lastSuccessfulPollAt: string | null;
  staleAfterMs: number;
};

export type DashboardPower = {
  status: "online" | "offline" | "unknown";
  checkedAt: string;
  staleAfterMs: number;
  lastOnlineAt: string | null;
  lastOfflineAt: string | null;
  events: { status: "online" | "offline" | "unknown"; observedAt: string }[];
};

export type PowerEvent = DashboardPower["events"][number];

type TelemetryRequest = { type: "telemetry" } & TelemetrySelection;

export type DashboardRequest =
  | TelemetryRequest
  | { type: "powerHistory"; start: number; end: number }
  | { type: "scheduleOverlay"; from: string; to: string; queue: string }
  | { type: "chargeHistory"; date: string }
  | { type: "outageHistory"; date: string; queue: string | null };

export type DashboardMessage =
  | { type: "scheduleOverlay"; from: string; to: string; queue: string; value: DashboardSchedule[] | null }
  | { type: "power"; value: DashboardPower | null }
  | { type: "powerHistory"; start: number; end: number; value: PowerEvent[] | null }
  | { type: "station"; value: DashboardStation }
  | { type: "outages"; value: DashboardOutages; schedulesChanged: boolean }
  | (TelemetryRequest & { value: TelemetryHistory | null })
  | { type: "chargeHistory"; date: string; value: TelemetryHistory | null }
  | { type: "outageHistory"; date: string; queue: string | null; value: DashboardSchedule[] | null }
  | { type: "status"; connected: boolean; history?: true };
