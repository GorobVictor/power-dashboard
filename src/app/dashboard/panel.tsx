import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { timeZone } from "@/server/outages/schedules";

const dateTimeFormat = new Intl.DateTimeFormat("uk-UA", {
  timeZone, dateStyle: "medium", timeStyle: "medium",
});

export function Timestamp({ value }: { value: Date }) {
  return <time dateTime={value.toISOString()} className="tabular-nums">{dateTimeFormat.format(value)}</time>;
}

const tones = {
  success: "border-transparent bg-success-surface text-success",
  warning: "border-transparent bg-warning-surface text-warning",
  danger: "border-transparent bg-danger-surface text-danger",
  muted: "border-transparent bg-muted text-muted-foreground",
};

export function StatusBadge({ tone, children }: { tone: keyof typeof tones; children: string }) {
  return <Badge variant="outline" className={tones[tone]}>{children}</Badge>;
}

export function PanelMessage({ title, children }: { title: string; children: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{children}</CardDescription>
      </CardHeader>
    </Card>
  );
}

export function PanelSkeleton({ label }: { label: string }) {
  return (
    <Card role="status">
      <span className="sr-only">{label}</span>
      <CardHeader aria-hidden="true">
        <Skeleton className="h-5 w-2/5" />
        <Skeleton className="h-4 w-3/5" />
      </CardHeader>
      <CardContent aria-hidden="true" className="grid grid-cols-2 gap-3">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </CardContent>
    </Card>
  );
}
