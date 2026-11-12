export const themeStorageKey = "power-dashboard.theme";

export const themes = [
  { id: "forest", label: "Ліс", color: "#125b48" },
  { id: "ocean", label: "Океан", color: "#155985" },
  { id: "violet", label: "Лаванда", color: "#684286" },
  { id: "sand", label: "Пісок", color: "#805320" },
  { id: "rose", label: "Троянда", color: "#914653" },
  { id: "forest-night", label: "Нічний ліс", color: "#1a222d" },
  { id: "ocean-night", label: "Нічний океан", color: "#152a3b" },
  { id: "violet-night", label: "Нічна лаванда", color: "#292236" },
  { id: "ember-night", label: "Вуглинка", color: "#35251e" },
  { id: "graphite", label: "Графіт", color: "#25282c" },
] as const;

export type Theme = typeof themes[number]["id"] | "system";
export function validTheme(value: string | null): Theme {
  return themes.some((theme) => theme.id === value) ? value as Theme : "system";
}
