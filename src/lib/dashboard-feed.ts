import type { ScheduleVersion } from "../server/outages/schedules.ts";
import type { SerializedMeasurement, Station } from "../server/stations/types.ts";

export const dashboardSocketPath = "/ws/dashboard";
export const dashboardSessionExpired = 4401;

export type DashboardStation =
  | { kind: "station"; station: Station; measurement: SerializedMeasurement | null; staleAfterMs: number }
  | { kind: "unconfigured" }
  | { kind: "missing" };

export type DashboardOutages = {
  schedules: (Omit<ScheduleVersion, "observedAt"> & { observedAt: string })[];
  lastSuccessfulPollAt: string | null;
  staleAfterMs: number;
};

export type DashboardMessage =
  | { type: "station"; value: DashboardStation }
  | { type: "outages"; value: DashboardOutages }
  | { type: "status"; connected: boolean };
