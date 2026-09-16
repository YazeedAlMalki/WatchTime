import type { Request, Response, NextFunction } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { db, usersTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { DEV_DEMO_COOKIE, DEV_DEMO_USER_ID, verifyDevToken } from "../routes/dev-auth";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      isAdmin?: boolean;
    }
  }
}

/**
 * Just-in-time provision a local user row for the Clerk user.
 * The first user ever registered becomes the single admin.
 */
async function ensureLocalUser(clerkUserId: string): Promise<{
  id: string;
  isAdmin: boolean;
}> {
  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, clerkUserId));
  if (existing.length > 0) {
    return { id: existing[0].id, isAdmin: existing[0].isAdmin };
  }
  let email = "";
  let name: string | null = null;
  try {
    const cu = await clerkClient.users.getUser(clerkUserId);
    email = cu.primaryEmailAddress?.emailAddress ?? "";
    name = [cu.firstName, cu.lastName].filter(Boolean).join(" ") || null;
  } catch {
    // Clerk lookup failure should not block provisioning
  }
  const [created] = await db
    .insert(usersTable)
    .values({ id: clerkUserId, email, name, isAdmin: false })
    .onConflictDoNothing()
    .returning();
  if (created) {
    // Promote the very first user to admin. The partial unique index
    // users_single_admin_idx guarantees at most one admin even under
    // concurrent first-signup races: the losing promotion simply fails.
    try {
      const [promoted] = await db
        .update(usersTable)
        .set({ isAdmin: true })
        .where(
          and(
            eq(usersTable.id, clerkUserId),
            sql`NOT EXISTS (SELECT 1 FROM users WHERE is_admin AND id <> ${clerkUserId})`,
          ),
        )
        .returning();
      if (promoted) return { id: promoted.id, isAdmin: promoted.isAdmin };
    } catch {
      // Unique violation: another user won the admin promotion race.
    }
    return { id: created.id, isAdmin: false };
  }
  const [row] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, clerkUserId));
  return { id: row.id, isAdmin: row.isAdmin };
}

async function ensureDevDemoUser(): Promise<{ id: string; isAdmin: boolean }> {
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, DEV_DEMO_USER_ID));
  if (existing) return { id: existing.id, isAdmin: false };
  const [created] = await db.insert(usersTable).values({
    id: DEV_DEMO_USER_ID, email: "demo@watchtime.local", name: "WatchTime Demo", isAdmin: false,
  }).onConflictDoNothing().returning();
  if (created) return { id: created.id, isAdmin: false };
  const [row] = await db.select().from(usersTable).where(eq(usersTable.id, DEV_DEMO_USER_ID));
  return { id: row.id, isAdmin: false };
}

function isValidDevAuth(req: Request): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  const bearer = req.get("authorization");
  const cookie = req.get("cookie")?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${DEV_DEMO_COOKIE}=`))?.slice(DEV_DEMO_COOKIE.length + 1);
  const token = bearer?.startsWith("Bearer ") ? bearer.slice(7) : cookie;
  return !!token && verifyDevToken(token);
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (isValidDevAuth(req)) {
    try {
      const user = await ensureDevDemoUser();
      req.userId = user.id;
      req.isAdmin = false;
      return next();
    } catch (err) {
      req.log.error({ err }, "failed to provision demo user");
      return res.status(500).json({ error: "Internal error" });
    }
  }
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;
  if (!clerkUserId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const user = await ensureLocalUser(clerkUserId);
    req.userId = user.id;
    req.isAdmin = user.isAdmin;
    return next();
  } catch (err) {
    req.log.error({ err }, "failed to provision user");
    return res.status(500).json({ error: "Internal error" });
  }
}

/** Attaches userId when signed in, but never rejects. */
export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  if (isValidDevAuth(req)) {
    try {
      const user = await ensureDevDemoUser();
      req.userId = user.id;
      req.isAdmin = false;
    } catch (err) {
      req.log.error({ err }, "optionalAuth demo provisioning failed");
    }
    return next();
  }
  const auth = getAuth(req);
  if (auth?.userId) {
    try {
      const user = await ensureLocalUser(auth.userId);
      req.userId = user.id;
      req.isAdmin = user.isAdmin;
    } catch (err) {
      req.log.error({ err }, "optionalAuth provisioning failed");
    }
  }
  next();
}

export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  return requireAuth(req, res, () => {
    if (!req.isAdmin) {
      return res.status(403).json({ error: "Forbidden" });
    }
    return next();
  });
}
