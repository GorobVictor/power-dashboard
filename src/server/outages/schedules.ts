export const timeZone = "Europe/Kyiv";
export const area = "kyivska-oblast";
export const operator = {
  id: "kyivska_oblast_oblenergo",
  name: "ПрАТ «ДТЕК Київські регіональні електромережі»",
};

const kyivDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone, year: "numeric", month: "2-digit", day: "2-digit",
});

export function kyivDate(now: Date) {
  return kyivDateFormatter.format(now);
}

export function isScheduleDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isQueue(value: unknown): value is string {
  return typeof value === "string" && /^\d+\.\d+$/.test(value);
}

type Status = "ScheduleApplies" | "WaitingForSchedule" | "NoShutdowns" | "EmergencyShutdowns";
type Hour = 0 | 1 | 2 | 3 | 9;

type Day = {
  status: Status;
  hours: Hour[];
  possible: Hour[];
};

export type ScheduleContent = Day & { publishedSchedule: (Day & { date: string }) | null };
export type Schedule = { queue: string; date: string; content: ScheduleContent };
export type ScheduleVersion = Omit<Schedule, "content"> & ScheduleContent & { observedAt: Date };

export class AlertsSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlertsSourceError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseStatus(value: unknown): Status {
  switch (value) {
    case "ScheduleApplies":
    case "WaitingForSchedule":
    case "NoShutdowns":
    case "EmergencyShutdowns":
      return value;
    default:
      throw new AlertsSourceError("Invalid schedule status");
  }
}

function parseHours(value: unknown): Hour[] {
  if (!Array.isArray(value) || (value.length !== 0 && value.length !== 24) ||
      !value.every((code: unknown) => code === 0 || code === 1 || code === 2 || code === 3 || code === 9)) {
    throw new AlertsSourceError("Invalid hourly schedule");
  }
  return value;
}

function parsePossible(value: unknown): Hour[] {
  const hours = parseHours(value ?? []);
  return hours.every((code) => code === 0) ? [] : hours;
}

function parsePublished(value: unknown): ScheduleContent["publishedSchedule"] {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) throw new AlertsSourceError("Invalid published schedule");
  const date = value.dateSlug ?? value.date_slug;
  if (!isScheduleDate(date)) throw new AlertsSourceError("Invalid published schedule date");
  return {
    date,
    status: parseStatus(value.status),
    hours: parseHours(value.hours),
    possible: parsePossible(value.possible),
  };
}

export function parseSchedules(payload: unknown): Schedule[] {
  if (!Array.isArray(payload)) throw new AlertsSourceError("Expected a regional schedule array");

  const schedules: Schedule[] = [];
  const seen = new Set<string>();
  for (const row of payload) {
    if (!isRecord(row) || typeof row.initiator !== "string" || !row.initiator) {
      throw new AlertsSourceError("Invalid regional schedule row");
    }
    if (row.initiator !== operator.id) continue;
    if (!isQueue(row.queue)) throw new AlertsSourceError("Invalid outage queue");

    for (const day of ["today", "tomorrow"] as const) {
      // The website API uses camelCase. The developer reference uses snake_case.
      const date = row[`${day}Date`] ?? row[`${day}_date`];
      const hours = parseHours(row[day] ?? []);
      const possible = parsePossible(row[`${day}Possible`] ?? row[`${day}_possible`]);
      const publishedSchedule = parsePublished(row[`${day}PublishedSchedule`] ?? row[`${day}_published_schedule`]);
      if ((date === undefined || date === null || date === "") &&
          !hours.length && !possible.length && !publishedSchedule) continue;
      if (!isScheduleDate(date)) throw new AlertsSourceError("Invalid schedule date");

      const key = `${row.queue}:${date}`;
      if (seen.has(key)) throw new AlertsSourceError("Duplicate schedule for a queue and date");
      seen.add(key);

      schedules.push({
        queue: row.queue,
        date,
        content: { status: parseStatus(row[`${day}Status`] ?? row[`${day}_status`]), hours, possible, publishedSchedule },
      });
    }
  }
  return schedules;
}
