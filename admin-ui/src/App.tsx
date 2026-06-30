import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api, type AdminState } from "./lib/api";
import { Register } from "./pages/Register";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Status } from "./pages/Status";
import { Settings } from "./pages/Settings";
import { Keys } from "./pages/Keys";
import { Invoices } from "./pages/Invoices";
import { Integration } from "./pages/Integration";
import { Accounting } from "./pages/Accounting";

export function App() {
  const [state, setState] = useState<AdminState | null>(null);
  const loc = useLocation();

  const refresh = () => api.state().then(setState).catch(() => setState({ registered: true, authenticated: false }));
  useEffect(() => {
    refresh();
  }, [loc.pathname]);

  if (!state) return <div className="center muted">Loading…</div>;

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
      <Route
        path="/"
        element={
          !state.registered ? (
            <Navigate to="/register" replace />
          ) : !state.authenticated ? (
            <Navigate to="/login" replace />
          ) : (
            <Dashboard onLogout={refresh} />
          )
        }
      >
        <Route index element={<Status />} />
        <Route path="settings" element={<Settings />} />
        <Route path="keys" element={<Keys />} />
        <Route path="invoices" element={<Invoices />} />
        <Route path="integration" element={<Integration />} />
        <Route path="accounting" element={<Accounting />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
