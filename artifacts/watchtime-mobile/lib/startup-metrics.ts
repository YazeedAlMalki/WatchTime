const startupStartedAt = Date.now();

/**
 * Logs startup checkpoints in development builds so cold starts can be
 * compared on physical devices without adding a runtime analytics dependency.
 */
export function markStartup(label: string) {
  if (!__DEV__) return;

  const elapsedMs = Date.now() - startupStartedAt;
  console.info(`[WatchTime startup] ${label}: ${elapsedMs}ms`);
}