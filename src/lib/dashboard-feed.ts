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

type TelemetryRequest = { type: "telemetry" } & TelemetrySelection;

export type DashboardRequest =
  | TelemetryRequest
  | { type: "chargeHistory"; date: string }
  | { type: "outageHistory"; date: string; queue: string | null };

export type DashboardMessage =
  | { type: "station"; value: DashboardStation }
  | { type: "outages"; value: DashboardOutages; schedulesChanged: boolean }
  | (TelemetryRequest & { value: TelemetryHistory | null })
  | { type: "chargeHistory"; date: string; value: TelemetryHistory | null }
  | { type: "outageHistory"; date: string; queue: string | null; value: DashboardSchedule[] | null }
  | { type: "status"; connected: boolean; history?: true };
