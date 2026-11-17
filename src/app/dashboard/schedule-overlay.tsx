"use client";

import { ZapOff } from "lucide-react";
import type { DashboardSchedule } from "@/lib/dashboard-feed";
import { scheduleOverlayBands } from "@/lib/schedule-overlay";

const fills = {
  outage: "color-mix(in srgb, var(--muted-foreground) 36%, transparent)",
  possible: "repeating-linear-gradient(135deg, color-mix(in srgb, var(--muted-foreground) 20%, transparent) 0 4px, color-mix(in srgb, var(--muted-foreground) 40%, transparent) 4px 6px)",
};

export function ScheduleHistoryBands({ schedules, start, end }: { schedules: DashboardSchedule[]; start: number; end: number }) {
  return <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-sm">
    {scheduleOverlayBands(schedules, start, end).map((band, index) => <span key={`${band.start}-${index}`} className="absolute inset-y-0 overflow-hidden"
      style={{ left: `${(band.start - start) / (end - start) * 100}%`, width: `${(band.end - band.start) / (end - start) * 100}%`, background: fills[band.kind] }}>
      {band.kind === "outage" && <span className="absolute inset-0 flex items-center justify-center text-foreground/70"><ZapOff className="h-auto max-h-full w-full max-w-5 shrink-0" /></span>}
    </span>)}
  </div>;
}

export function ScheduleHistoryLegend({ queue, schedules, from, to }: { queue: string | null; schedules: DashboardSchedule[] | null | undefined; from: string; to: string }) {
  if (!queue) return <p className="text-xs text-muted-foreground">Виберіть одну чергу, щоб показати графік відключень на вимірах.</p>;
  if (schedules === null) return <p role="status" className="text-xs text-muted-foreground">Не вдалося завантажити графік відключень для черги {queue}.</p>;
  if (!schedules) return <p role="status" className="text-xs text-muted-foreground">Завантажуємо графік відключень для черги {queue}…</p>;
  if (!schedules.length) return <p className="text-xs text-muted-foreground">За вибраний період немає збереженого графіка черги {queue}.</p>;
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  const available = new Set(schedules.filter((schedule) => schedule.status !== "WaitingForSchedule").map((schedule) => schedule.date)).size;
  return <div className="space-y-1 text-xs text-muted-foreground">
    <p>Останній збережений графік ДТЕК · черга {queue}</p>
    {available < days && <p>За частину вибраних днів графік недоступний.</p>}
    <div className="flex flex-wrap gap-x-3 gap-y-1"><span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-3 rounded-xs ring-1 ring-border" style={{ background: fills.outage }} />За графіком відключення</span><span className="flex items-center gap-1.5"><span aria-hidden="true" className="size-3 rounded-xs ring-1 ring-border" style={{ background: fills.possible }} />Можливе відключення</span></div>
  </div>;
}
