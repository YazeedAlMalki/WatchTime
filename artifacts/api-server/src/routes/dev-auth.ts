import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { isValidDevDemoCredentials } from "@workspace/dev-auth";

export const DEV_DEMO_USER_ID = "dev-demo-user";
export const DEV_DEMO_COOKIE = "watchtime_dev_demo";
const TOKEN_TTL_SECONDS = 15 * 60;

function sign(payload: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required for development authentication");
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function verifyDevToken(token: string): boolean {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  let expected: string;
  try { expected = sign(payload); } catch { return false; }
  if (signature.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return parsed.sub === DEV_DEMO_USER_ID && Number.isInteger(parsed.exp) && parsed.exp > Math.floor(Date.now() / 1000);
  } catch { return false; }
}

export function createDevToken(): string {
  const payload = Buffer.from(JSON.stringify({
    sub: DEV_DEMO_USER_ID,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

const router: IRouter = Router();
router.post("/dev-auth/login", (req, res) => {
  if (process.env.NODE_ENV !== "development") return res.status(404).json({ error: "Not found" });
  const { email, password } = req.body ?? {};
  if (typeof email !== "string" || typeof password !== "string" ||
      !isValidDevDemoCredentials(email, password)) {
    return res.status(401).json({ error: "Invalid demo credentials" });
  }
  let token: string;
  try { token = createDevToken(); } catch (error) {
    req.log.error({ err: error }, "unable to create development auth token");
    return res.status(500).json({ error: "Development authentication is unavailable" });
  }
  res.cookie(DEV_DEMO_COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: req.secure,
    maxAge: TOKEN_TTL_SECONDS * 1000, path: "/",
  });
  return res.json({ token, expiresIn: TOKEN_TTL_SECONDS, userId: DEV_DEMO_USER_ID });
});

export default router;