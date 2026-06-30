import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { api } from "../lib/api";

const TABS = [
  { to: "/", label: "Status", end: true },
  { to: "/settings", label: "Settings" },
  { to: "/keys", label: "API keys" },
  { to: "/invoices", label: "Invoices" },
  { to: "/accounting", label: "Accounting" },
  { to: "/integration", label: "LLM integration" },
];

export function Dashboard({ onLogout }: { onLogout: () => void }) {
  const nav = useNavigate();
  const logout = async () => {
    await api.logout();
    onLogout();
    nav("/login");
  };

  return (
    <div className="container">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>🛡️ Sentinelle</h1>
        <button onClick={logout}>Logout</button>
      </div>
      <nav className="tabs">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? "active" : "")}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
