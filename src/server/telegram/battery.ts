import type { Client } from "pg";
import { inTransaction } from "../db.ts";
import { saveMeasurement } from "../stations/repository.ts";
import type { Measurement, Station } from "../stations/types.ts";
import { escapeMarkdown } from "./markdown.ts";
import { describeOutageAt } from "./outages.ts";
import { enqueueTelegramMessages } from "./outbox.ts";

const BATTERY_TRANSITION_ALERT_BELOW_PCT = 99;
const BATTERY_LEVELS = [0, 10, 20, 30, 40, 50, 75] as const;

type BatteryReading = Pick<Measurement, "batteryPowerW" | "socPct">;
export type BatteryNotificationOptions = { outageQueue?: string };

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

export function batteryMessages(station: Station, previous: BatteryReading, current: BatteryReading) {
  const { batteryPowerW, socPct } = current;
  if (socPct === null) return [];
  const messages: string[] = [];
  const name = escapeMarkdown(station.name.slice(0, 200));
  const details = `${name}\n\nЗаряд: *${socPct}%*`;

  if (socPct < BATTERY_TRANSITION_ALERT_BELOW_PCT && batteryPowerW !== null && previous.batteryPowerW !== null) {
    if (batteryPowerW > 0 && previous.batteryPowerW <= 0) {
      messages.push(`⚡ *Акумулятор заряджається*\n${details}`);
    }
    if (batteryPowerW < 0) {
      if (previous.batteryPowerW >= 0) {
        messages.push(`🔋 *Акумулятор розряджається*\n${details}`);
      } else if (previous.socPct !== null && previous.socPct >= BATTERY_TRANSITION_ALERT_BELOW_PCT) {
        messages.push(`🔋 *Акумулятор розрядився нижче ${BATTERY_TRANSITION_ALERT_BELOW_PCT}%*\n${details}`);
      }
    }
  }
  const previousSoc = previous.socPct;
  const level = previousSoc === null ? undefined
    : BATTERY_LEVELS.find((threshold) => previousSoc > threshold && socPct <= threshold);
  if (level !== undefined) {
    const heading = level <= 40 ? `⚠️ *Небезпечний рівень заряду · ${level}%*` : `🔋 *Залишилося ${level}% заряду*`;
    messages.push(`${heading}\n${details}`);
  }
  return messages;
}

export async function saveBatteryReading(
  db: Client, station: Station, measurement: Measurement, previous: BatteryReading,
  { outageQueue }: BatteryNotificationOptions,
): Promise<BatteryReading> {
  const messages = batteryMessages(station, previous, measurement);
  const saved = messages.length === 0
    ? await saveMeasurement(db, station.id, measurement)
    : await inTransaction(db, async () => {
      if (!await saveMeasurement(db, station.id, measurement)) return false;
      const outage = outageQueue && await describeOutageAt(db, outageQueue, measurement.measuredAt);
      await enqueueTelegramMessages(db, outage ? messages.map((message) => `${message}\n\n📅 ${escapeMarkdown(outage)}`) : messages);
      return true;
    });

  if (!saved) return previous;
  return {
    batteryPowerW: measurement.batteryPowerW ?? previous.batteryPowerW,
    socPct: measurement.socPct ?? previous.socPct,
  };
}
