"use client";

import { cn } from "@/lib/utils";
import { useDashboardLive } from "./live";

export function ConnectionStatus({ mock }: { mock: boolean }) {
  const { connection } = useDashboardLive();
  const connected = connection === "connected";
  const label = mock ? "Демодані"
    : connected ? "Сервер підключено" : connection === "connecting" ? "Підключення до сервера…" : "Сервер: перепідключення…";
  return (
    <span role="status" className={cn(
      "inline-flex min-h-7 items-center gap-1.5 rounded-full px-2 text-[0.6875rem] font-medium whitespace-nowrap sm:px-2.5 sm:text-xs",
      connected ? "bg-success-surface text-success" : "bg-muted text-muted-foreground",
    )}>
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      <span className="sr-only sm:not-sr-only">{label}</span>
      <span aria-hidden="true" className="sm:hidden">{mock ? "Демо" : connected ? "Онлайн" : connection === "connecting" ? "З’єднання" : "Офлайн"}</span>
    </span>
  );
}
