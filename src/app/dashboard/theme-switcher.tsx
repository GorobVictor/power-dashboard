"use client";

import { Check, Palette } from "lucide-react";
import { useSyncExternalStore } from "react";
import { themes, themeStorageKey, validTheme, type Theme } from "@/lib/themes";

const themeChange = "power-dashboard-theme-change";
function readTheme(): Theme {
  return validTheme(document.documentElement.dataset.theme ?? null);
}
function subscribe(callback: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== themeStorageKey && event.key !== null) return;
    applyTheme(validTheme(event.key === null ? null : event.newValue));
    callback();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(themeChange, callback);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(themeChange, callback);
  };
}
function applyTheme(theme: Theme) {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}
function selectTheme(theme: Theme) {
  applyTheme(theme);
  try {
    if (theme === "system") localStorage.removeItem(themeStorageKey);
    else localStorage.setItem(themeStorageKey, theme);
  } catch {
    // The current page still uses the chosen theme when storage is unavailable.
  }
  window.dispatchEvent(new Event(themeChange));
}

export function ThemeSwitcher() {
  const selected = useSyncExternalStore(subscribe, readTheme, () => "system" as Theme);
  return (
    <details className="relative">
      <summary className="flex min-h-9 min-w-9 cursor-pointer list-none items-center justify-center gap-2 rounded-md px-2 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden" aria-label="Вибрати тему">
        <Palette aria-hidden="true" className="size-4" /> <span className="hidden sm:inline">Тема</span>
      </summary>
      <div className="absolute right-0 z-50 mt-1 max-h-[calc(100dvh-4rem)] w-52 overflow-y-auto rounded-lg border bg-card p-1.5 text-card-foreground shadow-lg" role="group" aria-label="Тема оформлення">
        {[
          { label: null, options: [{ id: "system" as const, label: "Як у системі", color: "linear-gradient(135deg, #f4f6f8 50%, #11171f 50%)" }] },
          { label: "Світлі теми", options: themes.slice(0, 5) },
          { label: "Темні теми", options: themes.slice(5) },
        ].map((group) => (
          <div key={group.label ?? "system"} role="group" aria-label={group.label ?? "Автоматична тема"}>
            {group.label && <p className="px-2 pb-1 pt-2 text-xs font-semibold text-muted-foreground">{group.label}</p>}
            {group.options.map((theme) => (
              <button key={theme.id} type="button" aria-pressed={selected === theme.id} onClick={(event) => { selectTheme(theme.id); event.currentTarget.closest("details")?.removeAttribute("open"); }}
                className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                <span aria-hidden="true" className="size-4 shrink-0 rounded-full border" style={{ background: theme.color }} />
                <span className="grow">{theme.label}</span>{selected === theme.id && <Check aria-hidden="true" className="size-4" />}
              </button>
            ))}
          </div>
        ))}
      </div>
    </details>
  );
}
