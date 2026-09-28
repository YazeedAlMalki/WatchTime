import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    // Guard: aborts before any test runs if DATABASE_URL looks production-like.
    setupFiles: ["./src/test-setup.ts"],
    // Run test files serially to avoid shared-database contention.
    pool: "forks",
    singleFork: true,
    fileParallelism: false,
  },
});
