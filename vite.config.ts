import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
export default defineConfig({
  base: "./",
  build: {
    target: "chrome120",
    rollupOptions: {
      input: {
        panel: resolve("panel.html"),
        floating: resolve("floating.html"),
        settings: resolve("settings.html"),
        background: resolve("src/background.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
      },
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
    restoreMocks: true,
  },
});
