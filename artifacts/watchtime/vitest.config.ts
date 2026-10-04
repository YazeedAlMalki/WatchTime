import path from "node:path";

export default {
  root: import.meta.dirname,
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["__tests__/**/*.test.tsx", "__tests__/**/*.test.ts"],
    exclude: ["__tests__/**/*.browser.test.tsx"],
  },
};