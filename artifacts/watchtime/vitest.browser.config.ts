import path from "node:path";
import { playwright } from "@vitest/browser-playwright";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: import.meta.dirname,
  plugins: [tailwindcss({ optimize: false })],
  esbuild: { jsx: "automatic" },
  optimizeDeps: {
    include: ["react", "react/jsx-dev-runtime", "react-dom/client", "@tanstack/react-query"],
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
    dedupe: ["react", "react-dom"],
  },
  test: {
    include: ["__tests__/**/*.browser.test.tsx"],
    browser: {
      enabled: true,
      headless: true,
      viewport: { width: 390, height: 844 },
      provider: playwright({
        launchOptions: {
          executablePath: process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium",
          args: ["--no-sandbox"],
        },
      }),
      instances: [{ browser: "chromium" }],
    },
  },
});