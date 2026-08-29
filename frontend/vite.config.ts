import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // allowedHosts: true is unreliable on some Vite 6.x releases (see
    // https://github.com/vitejs/vite/issues/19242). Use an explicit
    // suffix match instead so it actually works in prod behind nginx.
    allowedHosts: [".viraloapp.tech", "localhost"],
  },
  preview: {
    allowedHosts: [".viraloapp.tech", "localhost"],
  },
});
