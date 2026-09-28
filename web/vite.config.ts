import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * En desarrollo, la API se sirve por el MISMO origen (proxy): la sesión es una cookie y el
 * servidor rechaza pedidos de otro origen (protección CSRF). En producción lo hace nginx.
 */
const API = process.env.SINHUMO_API ?? "http://localhost:8080";
const proxied = ["/v1", "/auth", "/public", "/media", "/health"];

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: Object.fromEntries(proxied.map((p) => [p, { target: API, changeOrigin: false }])),
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
