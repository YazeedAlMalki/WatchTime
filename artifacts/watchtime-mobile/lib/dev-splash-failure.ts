import AsyncStorage from '@react-native-async-storage/async-storage';

export type DevSplashFailure = 'setup' | 'cleanup' | null;

const DEV_SPLASH_FAILURE_KEY = 'watchtime.devSplashFailure';
const DEV_FALLBACK_FONTS_KEY = 'watchtime.devFallbackFonts';

export async function readDevFallbackFonts(): Promise<boolean> {
  if (!__DEV__) return false;
  return (await AsyncStorage.getItem(DEV_FALLBACK_FONTS_KEY)) === '1';
}

export async function setDevFallbackFonts(enabled: boolean): Promise<void> {
  if (!__DEV__) {
    throw new Error('Fallback font selection is available only in development.');
  }

  if (enabled) {
    await AsyncStorage.setItem(DEV_FALLBACK_FONTS_KEY, '1');
  } else {
    await AsyncStorage.removeItem(DEV_FALLBACK_FONTS_KEY);
  }
}

export async function armDevSplashFailure(
  failure: Exclude<DevSplashFailure, null>,
): Promise<void> {
  if (!__DEV__) {
    throw new Error('Splash failure reproduction is available only in development.');
  }

  await AsyncStorage.setItem(DEV_SPLASH_FAILURE_KEY, failure);
}

export async function consumeDevSplashFailure(): Promise<DevSplashFailure> {
  if (!__DEV__) return null;

  try {
    const failure = await AsyncStorage.getItem(DEV_SPLASH_FAILURE_KEY);
    if (failure === null) return null;
    await AsyncStorage.removeItem(DEV_SPLASH_FAILURE_KEY);
    return failure === 'setup' || failure === 'cleanup' ? failure : null;
  } catch {
    // A failed debug preference read must not interfere with app startup.
    return null;
  }
}