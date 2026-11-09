-- Up Migration
CREATE TABLE stations (
    id text PRIMARY KEY,
    name text NOT NULL,
    model text NOT NULL,
    device_id text NOT NULL UNIQUE,
    ble_mac macaddr NOT NULL UNIQUE,
    collection_enabled boolean NOT NULL DEFAULT false
);

CREATE TABLE measurements (
    station_id text NOT NULL REFERENCES stations (id),
    measured_at timestamptz NOT NULL,
    soc_pct smallint CHECK (soc_pct BETWEEN 0 AND 100),
    remaining_energy_wh integer CHECK (remaining_energy_wh >= 0),
    battery_power_w smallint,
    grid_power_w smallint,
    ac_output_power_w smallint,
    backup_load_power_w smallint,
    inverter_state smallint,
    work_mode smallint,
    daily_energy_in_wh bigint CHECK (daily_energy_in_wh >= 0),
    daily_energy_out_wh bigint CHECK (daily_energy_out_wh >= 0),
    monthly_energy_in_wh bigint CHECK (monthly_energy_in_wh >= 0),
    monthly_energy_out_wh bigint CHECK (monthly_energy_out_wh >= 0),
    total_energy_in_wh bigint CHECK (total_energy_in_wh >= 0),
    total_energy_out_wh bigint CHECK (total_energy_out_wh >= 0),
    PRIMARY KEY (station_id, measured_at)
);

-- Down Migration
DROP TABLE measurements;
DROP TABLE stations;
