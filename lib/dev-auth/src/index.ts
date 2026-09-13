/**
 * Development-only authentication contract.
 *
 * This deliberately does not create a Clerk session or make a request. It is
 * only a local navigation aid for development and must never be used as API
 * authorization.
 */
export const DEV_DEMO_EMAIL = "demo@watchtime.local";
export const DEV_DEMO_PASSWORD = "watchtime-demo";

export type AuthEnvironment = "development" | "production";

/**
 * Keep the local demo contract behind an explicit build-environment boundary.
 * Production callers must use the real Clerk flow instead.
 */
export function isDevelopmentAuthEnabled(environment: AuthEnvironment): boolean {
  return environment === "development";
}

export function isValidDevDemoCredentials(
  email: string,
  password: string,
): boolean {
  return email.trim().toLowerCase() === DEV_DEMO_EMAIL && password === DEV_DEMO_PASSWORD;
}

/**
 * Only allow local app paths to be used as a post-demo destination.
 * Protocol-relative and absolute URLs intentionally fall back to home.
 */
export function getDevAuthDestination(returnTo?: string): string {
  const destination = returnTo?.trim();
  if (!destination || !destination.startsWith("/") || destination.startsWith("//")) {
    return "/";
  }
  return destination;
}