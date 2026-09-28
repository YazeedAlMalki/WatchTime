jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    removeItem: jest.fn(),
    setItem: jest.fn(),
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  armDevSplashFailure,
  consumeDevSplashFailure,
} from '../lib/dev-splash-failure';

const mockStoredValues = new Map<string, string>();
const mockStorage = jest.mocked(AsyncStorage);

describe('development splash failure switch', () => {
  beforeEach(() => {
    mockStoredValues.clear();
    mockStorage.getItem.mockClear();
    mockStorage.getItem.mockImplementation(
      async (key) => mockStoredValues.get(key) ?? null,
    );
    mockStorage.removeItem.mockClear();
    mockStorage.removeItem.mockImplementation(async (key) => {
      mockStoredValues.delete(key);
    });
    mockStorage.setItem.mockClear();
    mockStorage.setItem.mockImplementation(async (key, value) => {
      mockStoredValues.set(key, value);
    });
  });

  it.each(['setup', 'cleanup'] as const)(
    'stores and consumes a one-shot %s failure',
    async (failure) => {
      await armDevSplashFailure(failure);

      await expect(consumeDevSplashFailure()).resolves.toBe(failure);
      await expect(consumeDevSplashFailure()).resolves.toBeNull();
      expect(mockStorage.removeItem).toHaveBeenCalledTimes(1);
    },
  );

  it('does not arm or consume the switch in production', async () => {
    const runtime = globalThis as typeof globalThis & { __DEV__: boolean };
    const wasDev = runtime.__DEV__;
    runtime.__DEV__ = false;
    try {
      await expect(armDevSplashFailure('setup')).rejects.toThrow(
        'available only in development',
      );
      await expect(consumeDevSplashFailure()).resolves.toBeNull();
      expect(mockStorage.getItem).not.toHaveBeenCalled();
      expect(mockStorage.setItem).not.toHaveBeenCalled();
    } finally {
      runtime.__DEV__ = wasDev;
    }
  });
});