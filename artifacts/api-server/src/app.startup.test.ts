import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import supertest from "supertest";
import { publishableKeyFromHost } from "@clerk/shared/keys";

vi.mock("@clerk/shared/keys", { spy: true });

// Keep this startup-wiring regression independent of databases and background
// jobs, but exercise the real Clerk middleware and real health response.
vi.mock("./routes", async () => {
  const { Router } = await import("express");
  const { getAuth } = await import("@clerk/express");
  const router = Router();
  router.use((req, res) => {
    const auth = getAuth(req);
    res.status(auth.isAuthenticated ? 200 : 401).json({
      authenticated: auth.isAuthenticated,
    });
  });
  return { default: router };
});

let app: Express;

beforeAll(async () => {
  // Synthetic, nonfunctional keys; never use workspace credentials in tests.
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("LOG_LEVEL", "silent");
  vi.stubEnv("REPLIT_DOMAINS", "watchtime.example.com");
  vi.stubEnv("APP_HOST", "");
  vi.stubEnv("CUSTOM_DOMAIN", "");
  vi.stubEnv("CLERK_PUBLISHABLE_KEY",
    `pk_test_${Buffer.from("example.clerk.accounts.dev$").toString("base64")}`);
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_startup_regression_only");
  app = (await import("./app")).default;
});

beforeEach(() => vi.clearAllMocks());
afterAll(() => vi.unstubAllEnvs());

describe("deployment startup health", () => {
  it.each(["localhost:8080", "127.0.0.1:8080", "untrusted.example"])(
    "returns the public health response with internal or untrusted host %s",
    async (host) => {
      const result = await supertest(app).get("/api/healthz")
        .set("Host", host)
        .set("X-Forwarded-Host", "attacker.example")
        .set("Authorization", "Bearer invalid-token")
        .set("Cookie", "__session=invalid-session");

      expect(result.status).toBe(200);
      expect(result.body).toEqual({ status: "ok" });
      expect(publishableKeyFromHost).not.toHaveBeenCalled();
    },
  );

  it("supports HEAD probes without authentication", async () => {
    await supertest(app).head("/api/healthz").set("Host", "localhost:8080").expect(200);
    expect(publishableKeyFromHost).not.toHaveBeenCalled();
  });

  it("stays healthy even if Clerk is not configured", async () => {
    const key = process.env.CLERK_PUBLISHABLE_KEY;
    const secret = process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_PUBLISHABLE_KEY;
    delete process.env.CLERK_SECRET_KEY;
    try {
      await supertest(app).get("/api/healthz").set("Host", "localhost:8080")
        .expect(200, { status: "ok" });
    } finally {
      process.env.CLERK_PUBLISHABLE_KEY = key;
      process.env.CLERK_SECRET_KEY = secret;
    }
  });

  it("uses the configured key, not an untrusted host, for other requests", async () => {
    const result = await supertest(app).get("/api/private")
      .set("Host", "localhost:8080")
      .set("X-Forwarded-Host", "attacker.example");

    expect(result.status).toBe(401);
    expect(result.body).toEqual({ authenticated: false });
    expect(publishableKeyFromHost).not.toHaveBeenCalled();
  });

  it("keeps trusted public-host key resolution and signed-out protection", async () => {
    await supertest(app).get("/api/private")
      .set("Host", "watchtime.example.com")
      .set("X-Forwarded-Host", "attacker.example")
      .expect(401);

    expect(publishableKeyFromHost).toHaveBeenCalledWith(
      "watchtime.example.com", process.env.CLERK_PUBLISHABLE_KEY,
    );
  });

  it.each([
    ["post", "/api/healthz"],
    ["get", "/api/healthz/private"],
    ["get", "/api/healthz-extra"],
  ] as const)("does not bypass authentication for %s %s", async (method, path) => {
    await supertest(app)[method](path).set("Host", "localhost:8080").expect(401);
  });
});
