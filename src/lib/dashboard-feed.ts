import type { ScheduleVersion } from "../server/outages/schedules.ts";
import type { SerializedMeasurement, Station } from "../server/stations/types.ts";
import type { TelemetryHistory, TelemetryPeriod } from "./telemetry-history.ts";

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

export type DashboardRequest =
  | { type: "telemetry"; period: TelemetryPeriod }
  | { type: "outageHistory"; date: string; queue: string | null };

export type DashboardMessage =
  | { type: "station"; value: DashboardStation }
  | { type: "outages"; value: DashboardOutages; schedulesChanged: boolean }
  | { type: "telemetry"; period: TelemetryPeriod; value: TelemetryHistory | null }
  | { type: "outageHistory"; date: string; queue: string | null; value: DashboardSchedule[] | null }
  | { type: "status"; connected: boolean; history?: true };
