import assert from "node:assert/strict";
import test from "node:test";
import { scheduleMessage } from "../src/server/telegram/outages.ts";
import { batteryMessages } from "../src/server/telegram/battery.ts";
import type { Schedule, ScheduleContent } from "../src/server/outages/schedules.ts";
import type { Station } from "../src/server/stations/types.ts";

const content: ScheduleContent = {
  status: "ScheduleApplies", hours: [1, 0, 1, ...Array(21).fill(0)], possible: [], publishedSchedule: null,
};
const schedule = (changes: Partial<ScheduleContent> = {}): Schedule => ({
  date: "2026-11-12", queue: "3.2", content: { ...content, ...changes },
});

test("schedule notifications lead with the change and retain interval details", () => {
  const first = scheduleMessage(schedule(), null, false);
  assert.match(first, /^📅 \*З’явився графік ДТЕК\*/);
  assert.match(first, /Черга \*3\\\.2\* · 12\\\.11\\\.2026/);
  assert.match(first, /Зі світлом: \*22 год\*/);
  const better = scheduleMessage(schedule({ status: "NoShutdowns", hours: [] }), content, true);
  assert.match(better, /^🟢 \*Графік покращився · світла на 2 год більше\*/);
  assert.match(better, /Було: 00:00–01:00, 02:00–03:00\nСтало: —/);
  const worse = scheduleMessage(schedule(), { ...content, status: "NoShutdowns", hours: [] }, true);
  assert.match(worse, /^🔴 \*Графік погіршився · світла на 2 год менше\*/);
  const moved = scheduleMessage(schedule({ hours: [2, 3, 1, ...Array(21).fill(0)] }), content, true);
  assert.match(moved, /^🔄 \*Відключення перенесли · загальна тривалість не змінилася\*/);
  const possible = scheduleMessage(schedule({ possible: [3, ...Array(23).fill(0)] }), content, true);
  assert.match(possible, /^🔄 \*Змінилися можливі відключення\*/);
  assert.match(possible, /Було: —\nСтало: 00:30–01:00/);
  assert.doesNotMatch(possible, /Змінилися планові відключення/);
});

test("unknown durations never claim an improvement or rearrangement", () => {
  const incomplete = schedule({ hours: [1] });
  const emergency = schedule({ status: "EmergencyShutdowns", hours: Array(24).fill(9) });
  for (const message of [scheduleMessage(incomplete, content, true), scheduleMessage(emergency, content, true), scheduleMessage(schedule(), incomplete.content, true)]) {
    assert.match(message, /^⚠️ \*Графік оновився · порівняння недоступне\*/);
    assert.doesNotMatch(message, /покращився|погіршився|перенесли/);
  }
  assert.match(scheduleMessage(emergency, content, true), /аварійні обмеження/);
});

test("battery levels trigger at each threshold with the right severity", () => {
  const station = { name: "Station_1.0" } as Station;
  for (const level of [75, 50, 40, 30, 20, 10, 0]) {
    const messages = batteryMessages(station, { batteryPowerW: -10, socPct: level + 1 }, { batteryPowerW: -10, socPct: level });
    const heading = level <= 40 ? `⚠️ *Небезпечний рівень заряду · ${level}%*` : `🔋 *Залишилося ${level}% заряду*`;
    assert.deepEqual(messages, [`${heading}\nStation\\_1\\.0\n\nЗаряд: *${level}%*`]);
  }
});

test("battery levels handle skips, recovery, missing and first readings", () => {
  const station = { name: "Station" } as Station;
  const messages = (before: number | null, after: number | null) => batteryMessages(station,
    { batteryPowerW: -10, socPct: before }, { batteryPowerW: -10, socPct: after });
  assert.deepEqual(messages(80, 27), ["⚠️ *Небезпечний рівень заряду · 30%*\nStation\n\nЗаряд: *27%*"]);
  assert.deepEqual(messages(20, 19), []);
  assert.deepEqual(messages(19, 21), []);
  assert.match(messages(21, 20)[0], /20%/);
  assert.deepEqual(messages(null, 20), []);
  assert.deepEqual(messages(30, null), []);
  assert.deepEqual(messages(50, 50), []);
});

test("battery level and discharge transition can both be reported", () => {
  const station = { name: "Station" } as Station;
  assert.deepEqual(batteryMessages(station, { batteryPowerW: 10, socPct: 41 }, { batteryPowerW: -10, socPct: 40 }), [
    "🔋 *Акумулятор розряджається*\nStation\n\nЗаряд: *40%*",
    "⚠️ *Небезпечний рівень заряду · 40%*\nStation\n\nЗаряд: *40%*",
  ]);
});
