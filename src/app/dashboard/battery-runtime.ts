export function dischargeMinutes(energyWh: number | null, batteryPowerW: number | null) {
  if (energyWh === null || !Number.isFinite(energyWh) || energyWh < 0 ||
      batteryPowerW === null || !Number.isFinite(batteryPowerW) || batteryPowerW >= 0) return null;

  const minutes = energyWh / -batteryPowerW * 60;
  return Number.isFinite(minutes) ? minutes : null;
}

export function formatDischargeTime(minutes: number) {
  if (minutes === 0) return "0 хв";
  if (minutes < 1) return "< 1 хв";

  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const remainingMinutes = rounded % 60;
  if (hours >= 24) return `≈ ${Math.floor(hours / 24)} дн ${hours % 24} год`;
  if (hours > 0) return `≈ ${hours} год ${remainingMinutes} хв`;
  return `≈ ${remainingMinutes} хв`;
}
