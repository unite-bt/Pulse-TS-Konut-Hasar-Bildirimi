import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:5001", // Vite frontend /api isteklerini backend’e yollar
    },
    allowedHosts: [
      "59249a3b5131.ngrok-free.app",
      "35d6809d2c70.ngrok-free.app",
      "fee3c1790881.ngrok-free.app",
      "pulse.unitebt.com",
      "localhost",
      "5b19-88-240-155-173.ngrok-free.app",
      "https://99c5-85-98-18-181.ngrok-free.app",
      "localhost:5173",
      "7833-31-206-203-23.ngrok-free.app",
    ],
  },
  build: {
    assetsDir: "assets-damage-forms",
  },
});
