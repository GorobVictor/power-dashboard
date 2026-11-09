export interface Station {
  id: string;
  name: string;
  model: string;
}

export interface CollectorStation extends Station {
  deviceId: string;
  bleMac: string;
}

export interface Metrics {
  socPct: number | null;
  remainingEnergyWh: number | null;
  batteryPowerW: number | null;
  gridPowerW: number | null;
  acOutputPowerW: number | null;
  backupLoadPowerW: number | null;
  inverterState: number | null;
  workMode: number | null;
  dailyEnergyInWh: number | null;
  dailyEnergyOutWh: number | null;
  monthlyEnergyInWh: number | null;
  monthlyEnergyOutWh: number | null;
  totalEnergyInWh: number | null;
  totalEnergyOutWh: number | null;
}

export interface Measurement extends Metrics {
  measuredAt: Date;
}

export interface LatestMeasurement {
  station: Station;
  measurement: Measurement | null;
}
