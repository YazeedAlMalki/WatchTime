import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";
import { randomInt } from "node:crypto";
import { db, rateLimitHitsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

vi.mock("../lib/logger", () => ({
  logger: { warn: vi.fn() },
}));

import router from "./startup-diagnostics";
import { logger } from "../lib/logger";

const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use("/api", router);
const testIps = Array.from({ length: 3 }, () => `198.18.${randomInt(0, 256)}.${randomInt(1, 255)}`);

afterAll(async () => {
  await db.delete(rateLimitHitsTable).where(inArray(
    rateLimitHitsTable.key,
    testIps.map((ip) => `startup_diagnostics:${ip}`),
  ));
});

describe("startup diagnostics", () => {
  beforeEach(() => vi.clearAllMocks());

  it("records a safe event without auth or arbitrary error details", async () => {
    const res = await supertest(app)
      .post("/api/diagnostics/startup")
      .set("X-Forwarded-For", testIps[0])
      .send({ event: "splash-hide-error" });
    expect(res.status).toBe(204);
    expect(logger.warn).toHaveBeenCalledWith(
      { event: "splash-hide-error" },
      "mobile startup recovery failure",
    );
  });

  it("accepts the fixed splash-hide timeout event", async () => {
    const res = await supertest(app)
      .post("/api/diagnostics/startup")
      .set("X-Forwarded-For", testIps[1])
      .send({ event: "splash-hide-timeout" });

    expect(res.status).toBe(204);
    expect(logger.warn).toHaveBeenCalledWith(
      { event: "splash-hide-timeout" },
      "mobile startup recovery failure",
    );
  });

  it("records auth-provider startup failures without accepting exception details", async () => {
    const accepted = await supertest(app)
      .post("/api/diagnostics/startup")
      .set("X-Forwarded-For", testIps[0])
      .send({ event: "auth-provider-error" });

    expect(accepted.status).toBe(204);
    expect(logger.warn).toHaveBeenCalledWith(
      { event: "auth-provider-error" },
      "mobile startup recovery failure",
    );

    const rejected = await supertest(app)
      .post("/api/diagnostics/startup")
      .set("X-Forwarded-For", testIps[1])
      .send({
        event: "auth-provider-error",
        error: "Clerk failure for account private@example.com",
      });

    expect(rejected.status).toBe(400);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.anything() }),
      expect.anything(),
    );
  });

  it("rejects arbitrary text and extra fields without logging them", async () => {
    for (const body of [
      { event: "custom error: private content" },
      { event: "font-error", error: "private content" },
      { event: "font-error", userId: "private content" },
    ]) {
      const res = await supertest(app).post("/api/diagnostics/startup")
        .set("X-Forwarded-For", testIps[1]).send(body);
      expect(res.status).toBe(400);
    }
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("bounds public log volume", async () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const res = await supertest(app).post("/api/diagnostics/startup")
        .set("X-Forwarded-For", testIps[2]).send({ event: "font-error" });
      expect(res.status).toBe(204);
    }
    const blocked = await supertest(app).post("/api/diagnostics/startup")
      .set("X-Forwarded-For", testIps[2]).send({ event: "font-error" });
    expect(blocked.status).toBe(429);
    expect(logger.warn).toHaveBeenCalledTimes(10);
  });
});