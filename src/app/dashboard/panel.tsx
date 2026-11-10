import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { timeZone } from "@/server/outages/schedules";

const dateTimeFormat = new Intl.DateTimeFormat("uk-UA", {
  timeZone, dateStyle: "medium", timeStyle: "medium",
});

export function Timestamp({ value }: { value: Date | string }) {
  const date = typeof value === "string" ? new Date(value) : value;
  return <time dateTime={date.toISOString()} className="tabular-nums">{dateTimeFormat.format(date)}</time>;
}

const tones = {
  success: "border-transparent bg-success-surface text-success",
  warning: "border-transparent bg-warning-surface text-warning",
  danger: "border-transparent bg-danger-surface text-danger",
  muted: "border-transparent bg-muted text-muted-foreground",
};

export function StatusBadge({ tone, children, className }: { tone: keyof typeof tones; children: string; className?: string }) {
  return <Badge variant="outline" className={cn("motion-safe:transition-colors", tones[tone], className)}>{children}</Badge>;
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
