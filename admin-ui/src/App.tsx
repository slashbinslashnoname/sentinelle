import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api, type AdminState } from "./lib/api";
import { Register } from "./pages/Register";
import { Login } from "./pages/Login";
import { Layout } from "./pages/Layout";
import { Status } from "./pages/Status";
import { Keys } from "./pages/Keys";
import { Invoices } from "./pages/Invoices";
import { Integration } from "./pages/Integration";
import { Accounting } from "./pages/Accounting";
import { SettingsGroupPage } from "./pages/SettingsGroupPage";
import { SETTINGS_GROUPS } from "./lib/settingsSchema";

export function App() {
  const [state, setState] = useState<AdminState | null>(null);
  const loc = useLocation();

  const refresh = () =>
    api.state().then(setState).catch(() => setState({ registered: true, authenticated: false }));
  useEffect(() => {
    refresh();
  }, [loc.pathname]);

  if (!state) {
    return <div className="grid h-full place-items-center text-zinc-500">Loading…</div>;
  }

  const gateAuthed = (el: JSX.Element) =>
    !state.registered ? (
      <Navigate to="/register" replace />
    ) : !state.authenticated ? (
      <Navigate to="/login" replace />
    ) : (
      el
    );

  return (
    <Routes>
      <Route
        path="/register"
        element={state.registered ? <Navigate to="/login" replace /> : <Register onDone={refresh} />}
      />
      <Route
        path="/login"
        element={
          !state.registered ? (
            <Navigate to="/register" replace />
          ) : state.authenticated ? (
            <Navigate to="/" replace />
          ) : (
            <Login onDone={refresh} />
          )
        }
      />
      <Route path="/" element={gateAuthed(<Layout onLogout={refresh} />)}>
        <Route index element={<Status />} />
        <Route path="invoices" element={<Invoices />} />
        <Route path="keys" element={<Keys />} />
        <Route path="accounting" element={<Accounting />} />
        <Route path="integration" element={<Integration />} />
        <Route path="settings" element={<Navigate to={`/settings/${SETTINGS_GROUPS[0].path}`} replace />} />
        <Route path="settings/:group" element={<SettingsGroupPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
