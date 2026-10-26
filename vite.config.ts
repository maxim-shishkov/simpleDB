import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://tauri.app/v1/guides/getting-started/setup/vite
export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
