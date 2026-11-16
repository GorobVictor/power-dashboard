-- Up Migration
CREATE TABLE power_monitor_state (
    id boolean PRIMARY KEY DEFAULT true CHECK (id),
    status text NOT NULL CHECK (status IN ('online', 'offline', 'unknown')),
    last_known_status text CHECK (last_known_status IN ('online', 'offline')),
    checked_at timestamptz NOT NULL,
    stale_after_ms integer NOT NULL CHECK (stale_after_ms > 0),
    last_online_at timestamptz,
    last_offline_at timestamptz
);
CREATE TABLE power_monitor_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    status text NOT NULL CHECK (status IN ('online', 'offline', 'unknown')),
    observed_at timestamptz NOT NULL
);
CREATE INDEX power_monitor_events_time ON power_monitor_events (observed_at, id);

-- Down Migration
DROP TABLE power_monitor_events;
DROP TABLE power_monitor_state;
