import { timeZone } from "@/server/outages/schedules";

const hourFormat = new Intl.DateTimeFormat("uk-UA", { timeZone, hour: "2-digit", hourCycle: "h23" });
const hour = 60 * 60 * 1_000;

export function HourAxis({ start, end }: { start?: number; end?: number }) {
  const count = start !== undefined && end !== undefined ? Math.round((end - start) / hour) : 24;
  const labels = Array.from({ length: count + 1 }, (_, index) =>
    index === count ? "24" : start === undefined ? String(index).padStart(2, "0") : hourFormat.format(start + index * hour),
  );
  return <div aria-hidden="true" className="hour-axis text-[0.625rem] leading-tight text-muted-foreground tabular-nums">
    <div className="relative h-4">
      {labels.map((label, index) => (index === 0 || index === count || Number(label) % 4 === 0) && <span key={index}
        className="absolute"
        style={{ left: `${index / count * 100}%`, transform: index === 0 ? "none" : index === count ? "translateX(-100%)" : "translateX(-50%)" }}>{label}</span>)}
    </div>
  </div>;
}
