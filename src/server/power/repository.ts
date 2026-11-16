import type { Client, Pool } from "pg";
import type { DashboardPower, PowerEvent } from "../../lib/dashboard-feed.ts";

export async function readPower(db: Client): Promise<DashboardPower | null> {
  const { rows: [state] } = await db.query<{ status: DashboardPower["status"]; checkedAt: Date; staleAfterMs: number; lastOnlineAt: Date | null; lastOfflineAt: Date | null }>(
    `SELECT status, checked_at AS "checkedAt", stale_after_ms AS "staleAfterMs", last_online_at AS "lastOnlineAt", last_offline_at AS "lastOfflineAt" FROM power_monitor_state WHERE id`,
  );
  if (!state) return null;
  const { rows } = await db.query<{ status: DashboardPower["status"]; observedAt: Date }>(
    `(SELECT status, observed_at AS "observedAt", id FROM power_monitor_events WHERE observed_at < now() - interval '7 days' ORDER BY observed_at DESC, id DESC LIMIT 1)
     UNION ALL
     (SELECT status, observed_at AS "observedAt", id FROM power_monitor_events WHERE observed_at >= now() - interval '7 days')
     ORDER BY "observedAt", id`,
  );
  return {
    status: state.status, staleAfterMs: state.staleAfterMs, checkedAt: state.checkedAt.toISOString(), lastOnlineAt: state.lastOnlineAt?.toISOString() ?? null,
    lastOfflineAt: state.lastOfflineAt?.toISOString() ?? null,
    events: rows.map((row) => ({ status: row.status, observedAt: row.observedAt.toISOString() })),
  };
}

export async function readPowerEvents(db: Pool | Client, start: number, end: number): Promise<PowerEvent[]> {
  const { rows } = await db.query<{ status: PowerEvent["status"]; observedAt: Date }>(
    `(SELECT status, observed_at AS "observedAt", id FROM power_monitor_events WHERE observed_at < $1 ORDER BY observed_at DESC, id DESC LIMIT 1)
     UNION ALL
     (SELECT status, observed_at AS "observedAt", id FROM power_monitor_events WHERE observed_at >= $1 AND observed_at < $2)
     ORDER BY "observedAt", id`, [new Date(start), new Date(end)],
  );
  return rows.map((row) => ({ status: row.status, observedAt: row.observedAt.toISOString() }));
}
