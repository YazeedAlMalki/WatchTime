const startupStartedAt = Date.now();

type StartupDiagnosticDetails = Readonly<Record<string, unknown>>;

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
