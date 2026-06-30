import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { SETTINGS_GROUPS } from "../lib/settingsSchema";
import { currentTheme, setTheme, type Theme } from "../lib/theme";

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

const NAV = [
  { to: "/", label: "Dashboard", end: true, icon: "▰" },
  { to: "/invoices", label: "Invoices", icon: "▤" },
  { to: "/keys", label: "API keys", icon: "⚿" },
  { to: "/accounting", label: "Accounting", icon: "↧" },
  { to: "/integration", label: "LLM integration", icon: "✦" },
];

function itemClass({ isActive }: { isActive: boolean }) {
  return cx(
    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
    isActive
      ? "bg-primary-600 text-white"
      : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
  );
}

export function Layout({ onLogout }: { onLogout: () => void }) {
  const nav = useNavigate();
  const loc = useLocation();
  const [theme, setT] = useState<Theme>(currentTheme());
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    setT(next);
  };

  const logout = async () => {
    await api.logout();
    onLogout();
    nav("/login");
  };

  const settingsActive = loc.pathname.startsWith("/settings");

  const sidebar = (
    <div className="flex h-full flex-col gap-1 p-3">
      <div className="mb-3 flex items-center justify-between px-2 py-1">
        <span className="text-lg font-semibold tracking-tight">🛡️ Sentinelle</span>
        <button
          onClick={toggleTheme}
          title="Toggle theme"
          className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>
      </div>

      {NAV.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end} className={itemClass} onClick={() => setMobileOpen(false)}>
          <span className="w-4 text-center opacity-70">{n.icon}</span>
          {n.label}
        </NavLink>
      ))}

      <div className="mt-2">
        <div
          className={cx(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium",
            settingsActive ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-600 dark:text-zinc-300",
          )}
        >
          <span className="w-4 text-center opacity-70">⚙</span>
          Settings
        </div>
        <div className="ml-4 mt-1 flex flex-col gap-0.5 border-l border-zinc-200 pl-3 dark:border-zinc-800">
          {SETTINGS_GROUPS.map((g) => (
            <NavLink
              key={g.path}
              to={`/settings/${g.path}`}
              className={({ isActive }) =>
                cx(
                  "rounded-md px-2.5 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-primary-50 font-medium text-primary-700 dark:bg-zinc-800 dark:text-primary-500"
                    : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800",
                )
              }
              onClick={() => setMobileOpen(false)}
            >
              {g.title}
            </NavLink>
          ))}
        </div>
      </div>

      <div className="mt-auto">
        <button
          onClick={logout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <span className="w-4 text-center opacity-70">⎋</span>
          Logout
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-full">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 md:block">
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-20 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
            {sidebar}
          </aside>
        </div>
      )}

      <main className="min-w-0 flex-1 overflow-auto">
        <div className="border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900 md:hidden">
          <button onClick={() => setMobileOpen(true)} className="text-sm font-medium">
            ☰ Menu
          </button>
        </div>
        <div className="mx-auto max-w-5xl p-4 md:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
