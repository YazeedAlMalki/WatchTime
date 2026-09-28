import AsyncStorage from '@react-native-async-storage/async-storage';

export type DevSplashFailure = 'setup' | 'cleanup' | null;

const DEV_SPLASH_FAILURE_KEY = 'watchtime.devSplashFailure';

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