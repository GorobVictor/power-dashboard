"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useDashboardLive } from "./live";

export function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { connection, reconnect } = useDashboardLive();

  function refresh() {
    if (connection !== "connected") reconnect();
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex items-center gap-2">
      <span role="status" className="text-right text-xs text-muted-foreground">
        {connection === "disconnected" && "Відновлюємо з’єднання"}
      </span>
      <Button type="button" variant="outline" onClick={refresh} disabled={pending} aria-busy={pending} aria-label="Оновити" className="size-10 p-0 sm:w-auto sm:px-4">
        <RefreshCw aria-hidden="true" className={pending ? "motion-safe:animate-spin" : undefined} />
        <span className="hidden sm:inline">Оновити</span>
      </Button>
    </div>
  );
}
