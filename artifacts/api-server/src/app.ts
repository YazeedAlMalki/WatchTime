import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();
const standardJson = express.json({ limit: "1mb" });
const BODY_PARSER_ERROR_TYPES = new Set([
  "charset.unsupported",
  "encoding.unsupported",
  "entity.parse.failed",
  "entity.too.large",
  "entity.verify.failed",
  "parameters.too.many",
  "request.aborted",
  "request.size.invalid",
  "stream.encoding.set",
  "stream.not.readable",
]);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Allow the Expo mobile app (dev preview runs on a separate expo.* origin;
// native apps send no Origin header and pass through unaffected).
const allowedOrigins = new Set(
  [
    process.env.REPLIT_EXPO_DEV_DOMAIN,
    process.env.REPLIT_DEV_DOMAIN,
    ...(process.env.REPLIT_DOMAINS?.split(",") ?? []),
  ]
    .filter((d): d is string => Boolean(d))
    .map((d) => `https://${d.trim()}`),
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    credentials: true,
  }),
);

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// Transport overhead is allowed here; import-parsers enforces the 2 MiB limit
// against raw UTF-8 content itself.
// Imports are the one endpoint whose body may safely be large. Its route-local
// parser accepts the worst-case JSON escaping overhead, then validates the
// decoded UTF-8 content at 2 MiB. All other JSON remains tightly bounded.
app.use((req, res, next) => {
  if (req.method === "POST" && req.path === "/api/imports") return next();
  return standardJson(req, res, next);
});
app.use(express.urlencoded({ extended: true }));

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

// Global error handler — must be registered after all routes.
// Express 5 automatically forwards unhandled async-handler rejections here,
// so any thrown error (including a failed audit-log insert inside a transaction)
// is logged via pino and never silently dropped.
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _next: express.NextFunction,
  ) => {
    const parserError = typeof err === "object" && err !== null &&
      BODY_PARSER_ERROR_TYPES.has(String((err as { type?: unknown }).type));
    // body-parser attaches the raw request body to parse errors. Redact only
    // those errors; operational errors retain their useful message and stack.
    const safeError = parserError
      ? Object.assign(new Error("Request processing failed"), {
          name: err instanceof Error ? err.name : "UnknownError",
          type: (err as { type?: unknown }).type,
          status: (err as { status?: unknown }).status,
        })
      : err instanceof Error
        ? Object.assign(new Error(err.message), { name: err.name, stack: err.stack })
        : new Error("Unknown request error");
    logger.error({ err: safeError }, "unhandled request error");
    if (!res.headersSent) {
      if (parserError && (err as { status?: unknown })?.status === 413) {
        return res.status(413).json({ error: "Request body too large" });
      }
      if ((err as { status?: unknown })?.status === 400) {
        return res.status(400).json({ error: "Malformed request body" });
      }
      return res.status(500).json({ error: "Internal server error" });
    }
    return;
  },
);

export default app;
