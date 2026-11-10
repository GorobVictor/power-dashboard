import type { Client } from "pg";
import { inTransaction } from "../db.ts";
import { saveMeasurement } from "../stations/repository.ts";
import type { Measurement, Station } from "../stations/types.ts";
import { describeOutageAt } from "./outages.ts";
import { enqueueTelegramMessages } from "./outbox.ts";

const CHARGING_ALERT_BELOW_PCT = 95;
const DISCHARGING_ALERT_BELOW_PCT = 99;

type BatteryReading = Pick<Measurement, "batteryPowerW" | "socPct">;
export type BatteryNotificationOptions = { lowBatteryPct: number; outageQueue?: string };

export async function readBatteryBaseline(db: Client, stationId: string): Promise<BatteryReading> {
  const { rows } = await db.query<BatteryReading>(
    `SELECT
       (SELECT battery_power_w FROM measurements WHERE station_id = $1 AND battery_power_w IS NOT NULL
        ORDER BY measured_at DESC LIMIT 1) AS "batteryPowerW",
       (SELECT soc_pct FROM measurements WHERE station_id = $1 AND soc_pct IS NOT NULL
        ORDER BY measured_at DESC LIMIT 1) AS "socPct"`,
    [stationId],
  );
  return rows[0];
}

function batteryMessages(station: Station, previous: BatteryReading, current: BatteryReading, limit: number) {
  const { batteryPowerW, socPct } = current;
  const messages: string[] = [];
  const name = station.name.slice(0, 200);

  if (socPct !== null && batteryPowerW !== null && previous.batteryPowerW !== null) {
    if (batteryPowerW > 0 && previous.batteryPowerW <= 0 && socPct < CHARGING_ALERT_BELOW_PCT) {
      messages.push(`${name} · Акумулятор почав заряджатися. Заряд ${socPct}%.`);
    }
    if (batteryPowerW < 0 && previous.batteryPowerW >= 0 && socPct < DISCHARGING_ALERT_BELOW_PCT) {
      messages.push(`${name} · Акумулятор почав розряджатися. Заряд ${socPct}%.`);
    }
  }
  if (socPct !== null && previous.socPct !== null && socPct < limit && previous.socPct >= limit) {
    messages.push(`${name} · Заряд акумулятора впав до ${socPct}% (поріг ${limit}%).`);
  }
  return messages;
}

export async function saveBatteryReading(
  db: Client, station: Station, measurement: Measurement, previous: BatteryReading,
  { lowBatteryPct, outageQueue }: BatteryNotificationOptions,
): Promise<BatteryReading> {
  const messages = batteryMessages(station, previous, measurement, lowBatteryPct);
  const saved = messages.length === 0
    ? await saveMeasurement(db, station.id, measurement)
    : await inTransaction(db, async () => {
      if (!await saveMeasurement(db, station.id, measurement)) return false;
      const outage = outageQueue && await describeOutageAt(db, outageQueue, measurement.measuredAt);
      await enqueueTelegramMessages(db, outage ? messages.map((message) => `${message}\n${outage}`) : messages);
      return true;
    });

  if (!saved) return previous;
  return {
    batteryPowerW: measurement.batteryPowerW ?? previous.batteryPowerW,
    socPct: measurement.socPct ?? previous.socPct,
  };
}
