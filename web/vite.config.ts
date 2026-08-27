import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/v2": { target: "http://localhost:3001", changeOrigin: true },
      "/health": { target: "http://localhost:3001", changeOrigin: true },
      // Uploaded avatars and logos are served by the API, not by Vite.
      "/uploads": { target: "http://localhost:3001", changeOrigin: true },
    },
  },
});
