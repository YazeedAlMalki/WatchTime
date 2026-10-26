import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  moodDiscoveryStateTable,
  type MoodDiscoveryState,
} from "@workspace/db";
import {
  GetMyMoodDiscoveryStateResponse,
  UpdateMyMoodDiscoveryStateBody,
  UpdateMyMoodDiscoveryStateResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

const EMPTY_STATE: MoodDiscoveryState = {
  saved: [],
  savedContext: {},
  dismissed: [],
  viewed: {},
  feedback: {},
};

router.get("/me/mood-discovery", requireAuth, async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-cache");
  res.set("Vary", "Authorization, Cookie");
  const [versionedRecord] = await db
    .select({
      state: moodDiscoveryStateTable.state,
      revision: moodDiscoveryStateTable.revision,
    })
    .from(moodDiscoveryStateTable)
    .where(eq(moodDiscoveryStateTable.userId, req.userId!));

  res.json(
    GetMyMoodDiscoveryStateResponse.parse({
      state: versionedRecord?.state ?? EMPTY_STATE,
      revision: versionedRecord?.revision ?? 0,
    }),
  );
});

router.put("/me/mood-discovery", requireAuth, async (req, res): Promise<void> => {
  const parsed = UpdateMyMoodDiscoveryStateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const state = GetMyMoodDiscoveryStateResponse.parse({
    state: parsed.data.state,
    revision: parsed.data.expectedRevision,
  }).state as MoodDiscoveryState;
  const revision = parsed.data.expectedRevision;
  const [record] = revision === 0
    ? await db
        .insert(moodDiscoveryStateTable)
        .values({ userId: req.userId!, state, revision: 1 })
        .onConflictDoNothing({ target: moodDiscoveryStateTable.userId })
        .returning({
          state: moodDiscoveryStateTable.state,
          revision: moodDiscoveryStateTable.revision,
        })
    : await db
        .update(moodDiscoveryStateTable)
        .set({
          state,
          revision: sql`${moodDiscoveryStateTable.revision} + 1`,
          updatedAt: new Date(),
        })
        .where(and(
          eq(moodDiscoveryStateTable.userId, req.userId!),
          eq(moodDiscoveryStateTable.revision, revision),
        ))
        .returning({
          state: moodDiscoveryStateTable.state,
          revision: moodDiscoveryStateTable.revision,
        });

  res.set("Cache-Control", "private, no-cache");
  res.set("Vary", "Authorization, Cookie");
  if (record) {
    res.json(UpdateMyMoodDiscoveryStateResponse.parse({
      state: record.state,
      revision: record.revision,
      accepted: true,
    }));
    return;
  }

  const [latest] = await db
    .select({
      state: moodDiscoveryStateTable.state,
      revision: moodDiscoveryStateTable.revision,
    })
    .from(moodDiscoveryStateTable)
    .where(eq(moodDiscoveryStateTable.userId, req.userId!));
  res.json(UpdateMyMoodDiscoveryStateResponse.parse({
    state: latest?.state ?? EMPTY_STATE,
    revision: latest?.revision ?? 0,
    accepted: false,
  }));
});

export default router;
