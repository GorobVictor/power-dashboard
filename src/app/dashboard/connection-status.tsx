"use client";

import { cn } from "@/lib/utils";
import { useDashboardLive } from "./live";

export function ConnectionStatus() {
  const { connection } = useDashboardLive();
  const connected = connection === "connected";
  const label = connected ? "Наживо" : connection === "connecting" ? "Підключення…" : "Перепідключення…";
  return (
    <span role="status" className={cn(
      "inline-flex min-h-7 items-center gap-1.5 rounded-full px-2 text-[0.6875rem] font-medium whitespace-nowrap sm:px-2.5 sm:text-xs",
      connected ? "bg-success-surface text-success" : "bg-muted text-muted-foreground",
    )}>
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      {label}
    </span>
  );
}
