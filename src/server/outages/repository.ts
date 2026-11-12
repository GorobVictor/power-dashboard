import type { Client, Pool } from "pg";
import { area, operator } from "./schedules.ts";
import type { Schedule, ScheduleVersion } from "./schedules.ts";

export function outageSourceName() {
  const source = process.env.OUTAGE_SOURCE || "alerts.energy";
  if (source !== "alerts.energy" && source !== "dtek") {
    throw new Error("OUTAGE_SOURCE must be alerts.energy or dtek");
  }
  return source;
}

export function outageSourceId() {
  return `${outageSourceName()}:${area}:${operator.id}`;
}

type ScheduleChange = Schedule & { previousContent: Schedule["content"] | null };

export async function lockOutageSource(db: Client): Promise<boolean> {
  const { rows } = await db.query<{ acquired: boolean }>(
    "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
    [outageSourceId()],
  );
  return rows[0].acquired;
}

// The collector holds the source lock. Versions and the current snapshot commit together.
export async function saveOutagePoll(db: Client, schedules: Schedule[], observedAt: Date) {
  const { rows } = await db.query<ScheduleChange>(
    `WITH compared AS (
       SELECT input.*, previous.id AS previous_id, previous.content AS previous_content,
         input.content IS DISTINCT FROM previous.content AS changed
       FROM jsonb_to_recordset($2::jsonb) AS input(queue text, date date, content jsonb)
       LEFT JOIN LATERAL (
         SELECT id, content FROM outage_schedule_versions
         WHERE queue = input.queue AND schedule_date = input.date
         ORDER BY id DESC LIMIT 1
       ) AS previous ON true
     ), inserted AS (
       INSERT INTO outage_schedule_versions (queue, schedule_date, observed_at, content)
       SELECT queue, date, $3, content FROM compared WHERE changed
       RETURNING id
     ), current_versions AS (
       SELECT id FROM inserted
       UNION ALL
       SELECT previous_id FROM compared WHERE NOT changed
     ), snapshot AS (
       INSERT INTO outage_poll_state (source, last_successful_poll_at, current_version_ids)
       VALUES ($1, $3, ARRAY(SELECT id FROM current_versions))
       ON CONFLICT (source) DO UPDATE SET
         last_successful_poll_at = EXCLUDED.last_successful_poll_at,
         current_version_ids = EXCLUDED.current_version_ids
     )
     SELECT queue, to_char(date, 'YYYY-MM-DD') AS date, content, previous_content AS "previousContent"
     FROM compared WHERE changed ORDER BY compared.date, queue`,
    [outageSourceId(), JSON.stringify(schedules), observedAt],
  );
  return rows;
}

type VersionRow = Schedule & { observedAt: Date };

function toVersion({ queue, date, observedAt, content }: VersionRow): ScheduleVersion {
  return { queue, date, observedAt, ...content };
}

export async function findCurrentSchedules(db: Pool | Client, from: string, queue: string | null): Promise<{
  lastSuccessfulPollAt: Date | null;
  schedules: ScheduleVersion[];
}> {
  const { rows } = await db.query<(VersionRow | { queue: null }) & { lastSuccessfulPollAt: Date }>(
    `SELECT state.last_successful_poll_at AS "lastSuccessfulPollAt",
       v.queue, to_char(v.schedule_date, 'YYYY-MM-DD') AS date, v.observed_at AS "observedAt", v.content
     FROM outage_poll_state AS state
     LEFT JOIN outage_schedule_versions AS v
       ON v.id = ANY(state.current_version_ids)
       AND v.schedule_date >= $2::date AND ($3::text IS NULL OR v.queue = $3)
     WHERE state.source = $1
     ORDER BY v.schedule_date, v.queue`,
    [outageSourceId(), from, queue],
  );

  return {
    lastSuccessfulPollAt: rows[0]?.lastSuccessfulPollAt ?? null,
    schedules: rows.flatMap((row) => row.queue === null ? [] : [toVersion(row)]),
  };
}

export async function findScheduleHistory(db: Pool | Client, date: string, queue: string | null) {
  const { rows } = await db.query<VersionRow>(
    `SELECT queue, to_char(schedule_date, 'YYYY-MM-DD') AS date, observed_at AS "observedAt", content
     FROM outage_schedule_versions
     WHERE schedule_date = $1::date AND ($2::text IS NULL OR queue = $2)
     ORDER BY id`,
    [date, queue],
  );
  return rows.map(toVersion);
}
