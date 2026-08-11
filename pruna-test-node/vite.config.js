import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // 5173 is taken by the existing `storefront` dev server in this repo.
    port: 5174,
    // The API key lives only in the Express process; the dev server proxies to it.
    proxy: {
      "/api": {
        // Keep in step with the API server's API_PORT.
        target: `http://127.0.0.1:${process.env.API_PORT || 5000}`,
        changeOrigin: true,
      },
    },
  },
});
