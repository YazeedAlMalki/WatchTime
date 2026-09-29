import { reportStartupDiagnostic } from '@workspace/api-client-react';

const startupStartedAt = Date.now();

type StartupDiagnosticDetails = Readonly<Record<string, unknown>>;
export type StartupFailure =
  | 'font-error'
  | 'auth-provider-error'
  | 'splash-hide-error'
  | 'splash-hide-timeout'
  | 'splash-prevent-error';

/**
 * Logs startup checkpoints in development builds so cold starts can be
 * compared on physical devices without adding a runtime analytics dependency.
 */
export function markStartup(label: string, details?: StartupDiagnosticDetails) {
  if (!__DEV__) return;

  const elapsedMs = Date.now() - startupStartedAt;
  const message = `[WatchTime startup] ${label}: ${elapsedMs}ms`;

  if (details) {
    console.info(message, details);
    return;
  }

  console.info(message);
}

/**
 * Best-effort release evidence. Only a fixed event code is transmitted; never
 * send the underlying exception, which may contain device or account details.
 */
export function reportStartupFailure(event: StartupFailure): void {
  try {
    // A missing production domain must not accidentally send to the device's
    // own origin. Web previews can use their proxied relative /api path.
    if (!process.env.EXPO_PUBLIC_DOMAIN && !__DEV__) return;
    void Promise.resolve(reportStartupDiagnostic({ event })).catch(() => undefined);
  } catch {
    // Reporting must never interfere with rendering or splash recovery.
  }
}
