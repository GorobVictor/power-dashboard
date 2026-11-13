export function flowSummary(battery: number | null, grid: number | null, backup: number | null, inverterState: number | null = null) {
  if (inverterState === 6) return backup !== null && backup > 0
    ? "Байпас · резервний вихід працює" : "Станція в режимі байпаса";
  if (battery === null) return "Стан батареї невідомий";
  if (battery < 0) return backup !== null && backup > 0
    ? "Батарея розряджається · резервний вихід працює" : "Батарея розряджається";
  if (battery > 0) return grid !== null && grid < 0
    ? "Батарея заряджається · є споживання з мережі" : "Батарея заряджається";
  return "Батарея у спокої";
}

export function powerDirection(value: number | null, positive: string, negative: string): string {
  return value === null ? "Немає даних" : value > 0 ? positive : value < 0 ? negative : "Без обміну";
}

export function measurementAge(measuredAt: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - Date.parse(measuredAt)) / 1000));
  if (!Number.isFinite(seconds)) return "Час невідомий";
  if (seconds < 5) return "щойно";
  if (seconds < 60) return `${seconds} с тому`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} хв тому`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} год тому`;
  return `${Math.floor(seconds / 86400)} дн тому`;
}
