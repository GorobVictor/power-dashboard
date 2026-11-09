-- Up Migration
CREATE TABLE outage_schedule_versions (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    queue text NOT NULL,
    schedule_date date NOT NULL,
    observed_at timestamptz NOT NULL,
    content jsonb NOT NULL
);

CREATE INDEX outage_schedule_versions_date_queue_idx
    ON outage_schedule_versions (schedule_date, queue, id DESC);

CREATE TABLE outage_poll_state (
    source text PRIMARY KEY,
    last_successful_poll_at timestamptz NOT NULL,
    current_version_ids bigint[] NOT NULL
);

-- Down Migration
DROP TABLE outage_poll_state;
DROP TABLE outage_schedule_versions;
