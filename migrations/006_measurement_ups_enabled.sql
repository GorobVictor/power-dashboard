-- Up Migration
ALTER TABLE measurements ADD COLUMN ups_enabled boolean;

CREATE OR REPLACE FUNCTION dashboard_measurement_json(m measurements) RETURNS jsonb
LANGUAGE sql STABLE AS $$
    SELECT jsonb_build_object(
        'measuredAt', m.measured_at,
        'socPct', m.soc_pct, 'remainingEnergyWh', m.remaining_energy_wh,
        'batteryPowerW', m.battery_power_w, 'gridPowerW', m.grid_power_w,
        'acOutputPowerW', m.ac_output_power_w, 'backupLoadPowerW', m.backup_load_power_w,
        'inverterState', m.inverter_state, 'workMode', m.work_mode, 'upsEnabled', m.ups_enabled,
        'dailyEnergyInWh', m.daily_energy_in_wh, 'dailyEnergyOutWh', m.daily_energy_out_wh,
        'monthlyEnergyInWh', m.monthly_energy_in_wh, 'monthlyEnergyOutWh', m.monthly_energy_out_wh,
        'totalEnergyInWh', m.total_energy_in_wh, 'totalEnergyOutWh', m.total_energy_out_wh
    );
$$;

-- Down Migration
CREATE OR REPLACE FUNCTION dashboard_measurement_json(m measurements) RETURNS jsonb
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

ALTER TABLE measurements DROP COLUMN ups_enabled;
