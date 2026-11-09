import { getOutageHistory } from "@/server/outages/service";
import { ScheduleDetails } from "./outages";
import { Timestamp } from "./panel";

export async function OutageHistory({ date, queue }: { date: string; queue: string | null }) {
  let versions: Awaited<ReturnType<typeof getOutageHistory>>;
  try {
    versions = await getOutageHistory(date, queue);
  } catch (error) {
    console.error("Unable to load dashboard outage history", (error as Error).name);
    return <p className="text-sm text-danger">Історія тимчасово недоступна. Спробуйте оновити дашборд.</p>;
  }

  if (!versions.length) return <p className="text-sm text-muted-foreground">За вибрану дату немає збережених версій.</p>;

  return (
    <ol className="space-y-2.5" aria-label="Збережені версії графіка">
      {versions.map((version, index) => (
        <li key={`${version.queue}-${version.observedAt.toISOString()}-${index}`} className="space-y-3 rounded-lg border p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-1.5">
            <p className="text-sm font-medium">Версія {index + 1} · Черга {version.queue}</p>
            <p className="text-xs text-muted-foreground"><Timestamp value={version.observedAt} /></p>
          </div>
          <ScheduleDetails schedule={version} />
        </li>
      ))}
    </ol>
  );
}
