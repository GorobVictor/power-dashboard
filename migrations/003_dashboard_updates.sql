-- Up Migration
CREATE FUNCTION dashboard_measurement_json(m measurements) RETURNS jsonb
LANGUAGE sql STABLE AS $$
    SELECT jsonb_build_object(
        'measuredAt', m.measured_at,
        'socPct', m.soc_pct, 'remainingEnergyWh', m.remaining_energy_wh,
        'batteryPowerW', m.battery_power_w, 'gridPowerW', m.grid_power_w,
        'acOutputPowerW', m.ac_output_power_w, 'backupLoadPowerW', m.backup_load_power_w,
        'inverterState', m.inverter_state, 'workMode', m.work_mode,
        'dailyEnergyInWh', m.daily_energy_in_wh, 'dailyEnergyOutWh', m.daily_energy_out_wh,
        'monthlyEnergyInWh', m.monthly_energy_in_wh, 'monthlyEnergyOutWh', m.monthly_energy_out_wh,
        'totalEnergyInWh', m.total_energy_in_wh, 'totalEnergyOutWh', m.total_energy_out_wh
    );
$$;

CREATE FUNCTION notify_dashboard_measurement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_notify('power_dashboard_updates', jsonb_build_object(
        'type', 'measurement', 'stationId', NEW.station_id,
        'measurement', dashboard_measurement_json(NEW)
    )::text);
    RETURN NULL;
END;
$$;

CREATE FUNCTION notify_dashboard_station() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_notify('power_dashboard_updates', jsonb_build_object(
        'type', 'station', 'stationId', COALESCE(NEW.id, OLD.id)
    )::text);
    RETURN NULL;
END;
$$;

CREATE FUNCTION notify_dashboard_outages() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_notify('power_dashboard_updates', jsonb_build_object(
        'type', 'outages', 'source', NEW.source,
        'lastSuccessfulPollAt', NEW.last_successful_poll_at,
        'schedulesChanged', TG_OP = 'INSERT' OR NOT (
            NEW.current_version_ids @> OLD.current_version_ids AND
            OLD.current_version_ids @> NEW.current_version_ids
        )
    )::text);
    RETURN NULL;
END;
$$;

CREATE TRIGGER dashboard_measurement_inserted AFTER INSERT ON measurements
    FOR EACH ROW EXECUTE FUNCTION notify_dashboard_measurement();
CREATE TRIGGER dashboard_station_changed AFTER INSERT OR UPDATE OF name, model OR DELETE ON stations
    FOR EACH ROW EXECUTE FUNCTION notify_dashboard_station();
CREATE TRIGGER dashboard_outage_poll_saved AFTER INSERT OR UPDATE ON outage_poll_state
    FOR EACH ROW EXECUTE FUNCTION notify_dashboard_outages();

-- Down Migration
DROP TRIGGER dashboard_outage_poll_saved ON outage_poll_state;
DROP TRIGGER dashboard_station_changed ON stations;
DROP TRIGGER dashboard_measurement_inserted ON measurements;
DROP FUNCTION notify_dashboard_outages();
DROP FUNCTION notify_dashboard_station();
DROP FUNCTION notify_dashboard_measurement();
DROP FUNCTION dashboard_measurement_json(measurements);
