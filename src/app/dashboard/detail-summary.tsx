import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function DetailSummary({ children, expanded, controls, onToggle }: {
  children: ReactNode;
  expanded: boolean;
  controls: string;
  onToggle: () => void;
}) {
  return (
    <button type="button" aria-expanded={expanded} aria-controls={controls} onClick={onToggle}
      className="flex min-h-12 cursor-pointer items-center justify-between gap-2 rounded-xl px-4 py-3 text-sm font-semibold outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring sm:px-5 lg:hidden">
      <span className="flex items-center gap-2">{children}</span>
      <ChevronDown aria-hidden="true" className={cn("size-4 shrink-0 text-muted-foreground motion-safe:transition-transform motion-safe:duration-200", expanded && "rotate-180")} />
    </button>
  );
}
