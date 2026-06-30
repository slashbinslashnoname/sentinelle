// Light/dark theming. Defaults to the system preference; the choice (once the
// user toggles) is remembered in localStorage.

const KEY = "sentinelle-theme";

export type Theme = "light" | "dark";

export function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function currentTheme(): Theme {
  const saved = localStorage.getItem(KEY) as Theme | null;
  return saved ?? systemTheme();
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function setTheme(theme: Theme): void {
  localStorage.setItem(KEY, theme);
  applyTheme(theme);
}

export function initTheme(): void {
  applyTheme(currentTheme());
}
