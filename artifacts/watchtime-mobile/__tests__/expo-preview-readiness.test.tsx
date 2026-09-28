import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { ExpoPreviewReadiness } from '../components/ExpoPreviewReadiness';

const mockArmDevSplashFailure = jest.fn();
const mockReloadAppAsync = jest.fn();

jest.mock('expo', () => ({
  reloadAppAsync: (...args: unknown[]) => mockReloadAppAsync(...args),
}));

jest.mock('@/lib/dev-splash-failure', () => ({
  armDevSplashFailure: (...args: unknown[]) => mockArmDevSplashFailure(...args),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

describe('ExpoPreviewReadiness', () => {
  const originalSessionState =
    process.env.EXPO_PUBLIC_REPLIT_EXPO_CLI_SESSION_STATE;

  afterEach(() => {
    mockArmDevSplashFailure.mockReset().mockResolvedValue(undefined);
    mockReloadAppAsync.mockReset().mockResolvedValue(undefined);
    if (originalSessionState === undefined) {
      delete process.env.EXPO_PUBLIC_REPLIT_EXPO_CLI_SESSION_STATE;
    } else {
      process.env.EXPO_PUBLIC_REPLIT_EXPO_CLI_SESSION_STATE =
        originalSessionState;
    }
  });

  it.each(['setup', 'cleanup'] as const)(
    'arms the %s failure and reloads the native preview',
    async (failure) => {
      if (Platform.OS === 'web') return;

      mockArmDevSplashFailure.mockResolvedValue(undefined);
      mockReloadAppAsync.mockResolvedValue(undefined);
      const { getByTestId } = await render(<ExpoPreviewReadiness />);

      fireEvent.press(getByTestId(`splash-failure-${failure}`));

      await waitFor(() => {
        expect(mockArmDevSplashFailure).toHaveBeenCalledWith(failure);
        expect(mockReloadAppAsync).toHaveBeenCalledTimes(1);
      });
    },
  );

  it('does not expose failure controls in production builds', async () => {
    const runtime = globalThis as typeof globalThis & { __DEV__: boolean };
    const wasDev = runtime.__DEV__;
    runtime.__DEV__ = false;
    try {
      const { queryByTestId } = await render(<ExpoPreviewReadiness />);
      expect(queryByTestId('splash-failure-setup')).toBeNull();
      expect(queryByTestId('splash-failure-cleanup')).toBeNull();
    } finally {
      runtime.__DEV__ = wasDev;
    }
  });

  it('reports both phone preview sessions ready when the app is open and CLI login succeeded', async () => {
    process.env.EXPO_PUBLIC_REPLIT_EXPO_CLI_SESSION_STATE = 'ready';

    const { getByText, queryByText } = await render(
      <ExpoPreviewReadiness />,
    );

    expect(
      getByText(
        Platform.OS === 'web'
          ? 'Expo Go: Not confirmed — web preview does not verify phone sign-in'
          : 'Expo Go: Ready — WatchTime is open in Expo Go on this phone',
      ),
    ).toBeTruthy();
    expect(
      getByText('Expo CLI: Ready — Replit managed sign-in succeeded'),
    ).toBeTruthy();
    expect(queryByText(/This is a Replit sign-in blocker/)).toBeNull();
  });

  it.each(['blocked', 'unavailable', undefined])(
    'shows the Replit recovery path when CLI state is %s',
    async (state) => {
      if (state === undefined) {
        delete process.env.EXPO_PUBLIC_REPLIT_EXPO_CLI_SESSION_STATE;
      } else {
        process.env.EXPO_PUBLIC_REPLIT_EXPO_CLI_SESSION_STATE = state;
      }

      const { getByText } = await render(<ExpoPreviewReadiness />);

      expect(
        getByText(
          Platform.OS === 'web'
            ? 'Expo Go: Not confirmed — web preview does not verify phone sign-in'
            : 'Expo Go: Ready — WatchTime is open in Expo Go on this phone',
        ),
      ).toBeTruthy();
      expect(getByText(/This is a Replit sign-in blocker/)).toBeTruthy();
      expect(getByText(/Never enter your Replit password in Expo Go/)).toBeTruthy();
    },
  );
});