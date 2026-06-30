import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served by the backend under /admin, so the app is built with that base.
// In dev, proxy API + WebSocket + webhook calls to the Node backend.
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8080";

export default defineConfig({
  base: "/admin/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: BACKEND, changeOrigin: true },
      "/webhooks": { target: BACKEND, changeOrigin: true },
      "/ws": { target: BACKEND, ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
