import { positiveInteger } from "../config.ts";
import { database } from "../db.ts";
import { findLatest } from "./repository.ts";

export const stationStaleAfterMs = () => positiveInteger("STALE_AFTER_MS", 5_000);

export async function getLatestMeasurement(stationId: string) {
  const staleAfter = stationStaleAfterMs();
  const latest = await findLatest(database(), stationId);
  if (!latest) return null;

  const measuredAt = latest.measurement?.measuredAt;
  return {
    ...latest,
    stale: measuredAt ? Date.now() - measuredAt.getTime() >= staleAfter : null,
  };
}
