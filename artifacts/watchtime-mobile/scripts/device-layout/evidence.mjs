export const requiredProbes = {
  browse: ['browse-chip-All', 'browse-chip-TV Shows', 'browse-chip-Documentaries'],
  title: ['title-heading', 'title-watchlist', 'title-watched'],
};

// Deliberately do not infer hardware from a device name or requested capabilities.
export function classifyDevice(platform, info, usbPhysical = false, browserName = '') {
  if (browserName) return 'browser';
  if (platform === 'ios' && (info.isSimulator === 0 || info.isSimulator === false)) return 'physical';
  if (platform === 'ios' && (info.isSimulator === 1 || info.isSimulator === true)) return 'simulator';
  if (platform === 'android' && usbPhysical) return 'physical';
  return 'unverified-native';
}

export function validateConfig(config) {
  const endpoint = new URL(config.serverUrl);
  if (!['http:', 'https:'].includes(endpoint.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname) ||
      endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('Only a credential-free local Appium server is supported. Cloud providers require separate approval.');
  }
  const platform = String(config.capabilities?.platformName).toLowerCase();
  if (!['ios', 'android'].includes(platform)) throw new Error('platformName must be iOS or Android');
  for (const key of ['browseUrl', 'titleUrl']) {
    if (!config[key] || !['exp:', 'exps:', 'watchtime-mobile:'].includes(new URL(config[key]).protocol)) {
      throw new Error(`${key} must be a WatchTime or Expo native deep link`);
    }
  }
  if (!config.appId || typeof config.appId !== 'string') throw new Error('appId is required');
  if (!Number.isInteger(config.expected?.titleId) || config.expected.titleId < 1 ||
      !config.titleUrl.endsWith(`/title/${config.expected.titleId}`)) {
    throw new Error('expected.titleId must identify a real movie matching the titleUrl');
  }
  if (!(config.expected?.logicalWidth > 0) || !(config.expected?.fontScale > 0) ||
      !['loaded', 'fallback'].includes(config.expected?.fontState)) {
    throw new Error('expected logicalWidth, fontScale and fontState (loaded/fallback) are required');
  }
  if (config.capabilities.browserName) throw new Error('Browser sessions are not native evidence; use the separate browser checks');
  return platform;
}

export function assessScreen(screen, metadata, expected, platform) {
  const observations = [];
  const check = (name, pass, detail) => observations.push({ name, status: pass ? 'pass' : 'fail', detail });
  check('native screen', metadata.version === 1 && metadata.screen === screen &&
    metadata.platform === platform, `${metadata.platform}/${metadata.screen}`);
  check('content loaded', metadata.contentReady === true, 'Requires loaded catalog/title, not loading or error UI');
  if (screen === 'title') check('movie identity', metadata.titleId === expected.titleId,
    `actual ${metadata.titleId}; expected ${expected.titleId}`);
  check('logical width', Number.isFinite(metadata.logicalWidth) &&
    Math.abs(metadata.logicalWidth - expected.logicalWidth) < 1,
  `actual ${metadata.logicalWidth}; expected ${expected.logicalWidth}`);
  check('font scale', Number.isFinite(metadata.fontScale) &&
    Math.abs(metadata.fontScale - expected.fontScale) < 0.02,
  `actual ${metadata.fontScale}; expected ${expected.fontScale}`);
  const states = Object.values(metadata.fonts ?? {});
  check('font loading state', states.length === 4 && states.every((s) => s === expected.fontState),
    JSON.stringify(metadata.fonts));
  for (const id of requiredProbes[screen]) {
    const measurement = metadata.measurements?.[id];
    const measured = measurement && Number.isFinite(measurement.width) && measurement.width > 0 &&
      Number.isFinite(measurement.height) && measurement.height > 0 &&
      Array.isArray(measurement.lines) && measurement.lines.length > 0;
    // Native line coordinates are logical units. Allow 2 units for rounding.
    const fits = measured && measurement.lines.every((line) =>
      [line.x, line.y, line.width, line.height].every(Number.isFinite) &&
      line.width > 0 && line.height > 0 &&
      line.x >= -2 && line.y >= -2 &&
      line.x + line.width <= measurement.width + 2 &&
      line.y + line.height <= measurement.height + 2);
    check(id, Boolean(fits), measured ? JSON.stringify(measurement) : 'Missing native text measurement');
  }
  return observations;
}
