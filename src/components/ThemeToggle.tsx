import type { Theme } from "../types";

export function ThemeToggle({
  theme,
  onChange,
}: {
  theme: Theme;
  onChange: (t: Theme) => void;
}) {
  return (
    <button
      className="theme-toggle"
      onClick={() => onChange(theme === "light" ? "dark" : "light")}
      title="Переключить тему"
    >
      {theme === "light" ? "🌙 Тёмная" : "☀️ Светлая"}
    </button>
  );
}
