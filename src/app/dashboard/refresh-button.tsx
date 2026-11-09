"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useTransition } from "react";
import { Button } from "@/components/ui/button";

export function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const refreshing = useRef(false);

  const refresh = useCallback(() => {
    if (refreshing.current) return;
    refreshing.current = true;
    startTransition(() => router.refresh());
  }, [router]);

  useEffect(() => {
    if (pending) return;
    refreshing.current = false;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [pending, refresh]);

  return (
    <Button type="button" variant="outline" onClick={refresh} disabled={pending} aria-busy={pending}>
      <RefreshCw aria-hidden="true" className={pending ? "motion-safe:animate-spin" : undefined} />
      Оновити
    </Button>
  );
}
