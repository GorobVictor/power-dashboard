import type { DashboardPower } from "../../lib/dashboard-feed.ts";
import { database } from "../db.ts";
import { readPowerState } from "./repository.ts";

type PowerState = Omit<DashboardPower, "events">;

export function powerStatus(state: PowerState | null, now: number) {
  if (!state) return null;
  const age = now - Date.parse(state.checkedAt);
  const stale = !Number.isFinite(age) || age < 0 || age >= state.staleAfterMs;
  return {
    status: stale ? "unknown" as const : state.status, stale,
    checkedAt: state.checkedAt, staleAfterMs: state.staleAfterMs,
    lastOnlineAt: state.lastOnlineAt, lastOfflineAt: state.lastOfflineAt,
  };
}

export async function getPowerStatus(now = Date.now()) {
  return powerStatus(await readPowerState(database()), now);
}
