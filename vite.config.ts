import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  base: "./",
  build: {
    outDir: "build",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@assets": path.resolve(__dirname, "./src/assets"),
      "@components": path.resolve(__dirname, "./src/components"),
      "@stores": path.resolve(__dirname, "./src/stores"),
      "@ipc": path.resolve(__dirname, "./src/ipc"),
      "@themes": path.resolve(__dirname, "./src/themes"),
      "@utils": path.resolve(__dirname, "./src/utils"),
      "@hooks": path.resolve(__dirname, "./src/hooks"),
      "@i18n": path.resolve(__dirname, "./src/i18n"),
      "@notify": path.resolve(__dirname, "./src/notify"),
    },
  },
  plugins: [react()],
});
