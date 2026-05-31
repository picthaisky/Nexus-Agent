import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8080", changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, "") },
      "/health": { target: "http://localhost:8080", changeOrigin: true },
      "/ready": { target: "http://localhost:8080", changeOrigin: true },
      "/info": { target: "http://localhost:8080", changeOrigin: true },
      "/tasks": { target: "http://localhost:8080", changeOrigin: true },
      "/agentspace": { target: "http://localhost:8080", changeOrigin: true },
      "/agents": { target: "http://localhost:8080", changeOrigin: true },
      "/repo": { target: "http://localhost:8080", changeOrigin: true },
      "/docs": { target: "http://localhost:8080", changeOrigin: true },
      "/ws":  { target: "ws://localhost:8080",   ws: true, changeOrigin: true }
    }
  }
});
