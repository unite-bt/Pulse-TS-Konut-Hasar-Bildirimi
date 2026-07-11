import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:3000", // Vite frontend /api isteklerini backend'e yollar
      "/tskonutihbariagent/api": "http://localhost:3000",
    },
    allowedHosts: ["pulse.unitebt.com", "localhost", "localhost:5173"],
  },
  build: {
    assetsDir: "assets-damage-forms",
  },
});
