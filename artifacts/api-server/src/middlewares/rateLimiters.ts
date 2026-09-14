import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";
import { DrizzleRateLimitStore } from "./drizzleRateLimitStore";

/**
 * Key generator that prefers authenticated userId, falls back to IP (with IPv6 normalisation).
 */
function userOrIpKey(req: Request): string {
  if ((req as any).userId) return (req as any).userId as string;
  return ipKeyGenerator(req.ip ?? "");
}

/**
 * POST /api/feedback — 5 per hour per IP
 */
export const feedbackRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 5,
  standardHeaders: "draft-7", // Return RateLimit-* headers
  legacyHeaders: false,
  store: new DrizzleRateLimitStore("feedback"),
  message: { error: "Too many feedback submissions. Please wait before trying again." },
});

/**
 * GET /api/stats/public — 60 per minute per IP.
 * The route also caches its database result, but this bounds abusive request volume.
 */
export const publicStatsRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: new DrizzleRateLimitStore("public_stats"),
  message: { error: "Too many stats requests. Please wait before trying again." },
});

/**
 * POST /api/titles/:id/safety/reports — 10 per hour per user (falling back to IP).
 * Must be placed after requireAuth so req.userId is populated.
 */
export const safetyReportRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  store: new DrizzleRateLimitStore("safety_report"),
  message: { error: "Too many safety reports. Please wait before submitting another." },
});

/**
 * POST /api/titles/:id/safety/contributions — 20 per day per user (falling back to IP).
 * Must be placed after requireAuth so req.userId is populated.
 */
export const safetyContributionRateLimit = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  store: new DrizzleRateLimitStore("safety_contribution"),
  message: { error: "Daily contribution limit reached. You can submit more contributions tomorrow." },
});

/** Upload parsing is intentionally scarce: bounded documents are still expensive. */
export const importCreateRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  store: new DrizzleRateLimitStore("import_create"),
  message: { error: "Too many import uploads. Please wait before trying again." },
});

/** Confirmation is separately bounded to protect transactional tracking writes. */
export const importConfirmRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  store: new DrizzleRateLimitStore("import_confirm"),
  message: { error: "Too many import confirmations. Please wait before trying again." },
});
