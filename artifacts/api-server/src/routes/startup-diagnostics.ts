import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { logger } from "../lib/logger";
import { DrizzleRateLimitStore } from "../middlewares/drizzleRateLimitStore";

const router: IRouter = Router();

// This route is public because it must work before sign-in. Keep its payload
// fixed and limit how often a device can write to the server logs.
const limitReports = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  store: new DrizzleRateLimitStore("startup_diagnostics"),
});

const events = new Set([
  "auth-provider-error",
  "font-error",
  "splash-hide-error",
  "splash-hide-timeout",
  "splash-prevent-error",
]);

router.post("/diagnostics/startup", limitReports, (req, res) => {
  const body = req.body;
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !events.has(body.event)
  ) {
    return res.status(400).json({ error: "Invalid startup diagnostic" });
  }

  // Never log the request, user data, arbitrary error text, or stack traces.
  logger.warn({ event: body.event }, "mobile startup recovery failure");
  return res.sendStatus(204);
});

export default router;