import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const inputClassName =
  "h-10 w-full min-w-0 max-w-full appearance-none rounded-md border border-input bg-background px-3 text-base shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 sm:text-sm";

export const selectClassName = `${inputClassName} dashboard-select`;

export function Input({ className, type, ...props }: ComponentProps<"input">) {
  return <input type={type} data-slot="input" className={cn(inputClassName, className)} {...props} />;
}
