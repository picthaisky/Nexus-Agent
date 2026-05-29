import React from "react";
import Dashboard from "./components/Dashboard";
import Login from "./components/Login";
import { useAuth } from "./auth";

/**
 * Top-level gate: shows the login screen until an API key is provided
 * (or always renders the dashboard if auth is disabled at the backend).
 *
 * Set ``VITE_REQUIRE_AUTH=false`` in development to skip this gate.
 */
export function App() {
  const { isAuthenticated } = useAuth();
  const requireAuth = (import.meta.env.VITE_REQUIRE_AUTH ?? "true") !== "false";
  if (requireAuth && !isAuthenticated) return <Login />;
  return <Dashboard />;
}

export default App;
