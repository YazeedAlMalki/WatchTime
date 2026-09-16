import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'watchtime.devDemoSession';

type StoredDemoSession = {
  token: string;
  expiresAt: number;
};

function webStorage(): Storage | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}

export async function saveDevDemoSession(token: string, expiresIn: number): Promise<void> {
  const value = JSON.stringify({
    token,
    expiresAt: Date.now() + expiresIn * 1_000,
  } satisfies StoredDemoSession);

  if (Platform.OS === 'web') {
    webStorage()?.setItem(STORAGE_KEY, value);
    return;
  }
  await SecureStore.setItemAsync(STORAGE_KEY, value);
}

export async function getDevDemoToken(): Promise<string | null> {
  const value = Platform.OS === 'web'
    ? webStorage()?.getItem(STORAGE_KEY) ?? null
    : await SecureStore.getItemAsync(STORAGE_KEY);
  if (!value) return null;

  try {
    const session = JSON.parse(value) as StoredDemoSession;
    if (
      typeof session.token === 'string'
      && typeof session.expiresAt === 'number'
      && session.expiresAt > Date.now()
    ) {
      return session.token;
    }
  } catch {
    // Clear malformed state below.
  }

  if (Platform.OS === 'web') webStorage()?.removeItem(STORAGE_KEY);
  else await SecureStore.deleteItemAsync(STORAGE_KEY);
  return null;
}

export async function clearDevDemoSession(): Promise<void> {
  if (Platform.OS === 'web') webStorage()?.removeItem(STORAGE_KEY);
  else await SecureStore.deleteItemAsync(STORAGE_KEY);
}