import { afterEach, beforeEach, describe, expect, it } from "vitest";
import supertest from "supertest";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import app from "../app";
import { DEV_DEMO_USER_ID } from "./dev-auth";

describe("development demo authentication", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSessionSecret = process.env.SESSION_SECRET;

  beforeEach(async () => {
    process.env.NODE_ENV = "development";
    process.env.SESSION_SECRET = "test-only-demo-session-secret";
    await db.delete(usersTable).where(eq(usersTable.id, DEV_DEMO_USER_ID));
  });

  afterEach(async () => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.SESSION_SECRET = originalSessionSecret;
    await db.delete(usersTable).where(eq(usersTable.id, DEV_DEMO_USER_ID));
  });

  it("creates a non-admin session that can call protected APIs", async () => {
    const login = await supertest(app)
      .post("/api/dev-auth/login")
      .send({ email: "demo@watchtime.local", password: "watchtime-demo" })
      .expect(200);

    const profile = await supertest(app)
      .get("/api/me")
      .set("Authorization", `Bearer ${login.body.token}`)
      .expect(200);

    expect(profile.body.id).toBe(DEV_DEMO_USER_ID);
    const [demoUser] = await db.select().from(usersTable)
      .where(eq(usersTable.id, DEV_DEMO_USER_ID));
    expect(demoUser.isAdmin).toBe(false);
  });

  it("is unavailable and rejects its token outside development", async () => {
    const login = await supertest(app)
      .post("/api/dev-auth/login")
      .send({ email: "demo@watchtime.local", password: "watchtime-demo" })
      .expect(200);

    process.env.NODE_ENV = "production";
    await supertest(app)
      .post("/api/dev-auth/login")
      .send({ email: "demo@watchtime.local", password: "watchtime-demo" })
      .expect(404);
    await supertest(app)
      .get("/api/me")
      .set("Authorization", `Bearer ${login.body.token}`)
      .expect(401);
  });
});