/**
 * Global test setup — runs once before the suite.
 *
 * Guards against running destructive integration tests against a production
 * database. Two complementary checks are applied:
 *
 *  1. NODE_ENV must not be "production" — Replit deployments always set this.
 *  2. DATABASE_URL must not contain the substring "prod" — catches manually
 *     configured production connection strings regardless of NODE_ENV.
 *
 * If either guard fires the entire suite aborts before any rows are written
 * or deleted.
 */

const url = process.env.DATABASE_URL ?? "";
const env = process.env.NODE_ENV ?? "";

if (env === "production") {
  throw new Error(
    "Integration tests must not run in NODE_ENV=production. " +
      "Replit deployments set this automatically; never run `pnpm test` in production.",
  );
}

if (/prod/i.test(url)) {
  throw new Error(
    "Integration tests must not run against a production database.\n" +
      "DATABASE_URL contains 'prod'. Set DATABASE_URL to a development or " +
      "test database before running tests.",
  );
}
