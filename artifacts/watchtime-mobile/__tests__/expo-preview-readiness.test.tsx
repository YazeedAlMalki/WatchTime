import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { ExpoPreviewReadiness } from '../components/ExpoPreviewReadiness';

const mockArmDevSplashFailure = jest.fn();
const mockReadDevFallbackFonts = jest.fn().mockResolvedValue(false);
const mockSetDevFallbackFonts = jest.fn();
const mockReloadAppAsync = jest.fn();

jest.mock('expo', () => ({
  reloadAppAsync: (...args: unknown[]) => mockReloadAppAsync(...args),
}));

jest.mock('@/lib/dev-splash-failure', () => ({
  armDevSplashFailure: (...args: unknown[]) => mockArmDevSplashFailure(...args),
  readDevFallbackFonts: (...args: unknown[]) => mockReadDevFallbackFonts(...args),
  setDevFallbackFonts: (...args: unknown[]) => mockSetDevFallbackFonts(...args),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

describe('ExpoPreviewReadiness', () => {
  const originalSessionState =
    process.env.EXPO_PUBLIC_REPLIT_EXPO_CLI_SESSION_STATE;
  const originalSkipInterLoading =
    process.env.EXPO_PUBLIC_SKIP_INTER_LOADING;

  afterEach(() => {
    mockArmDevSplashFailure.mockReset().mockResolvedValue(undefined);
    mockReadDevFallbackFonts.mockReset().mockResolvedValue(false);
    mockSetDevFallbackFonts.mockReset().mockResolvedValue(undefined);
    mockReloadAppAsync.mockReset().mockResolvedValue(undefined);
    if (originalSkipInterLoading === undefined) {
      delete process.env.EXPO_PUBLIC_SKIP_INTER_LOADING;
    } else {
      process.env.EXPO_PUBLIC_SKIP_INTER_LOADING = originalSkipInterLoading;
    }
    if (originalSessionState === undefined) {
      delete process.env.EXPO_PUBLIC_REPLIT_EXPO_CLI_SESSION_STATE;
    } else {
      process.env.EXPO_PUBLIC_REPLIT_EXPO_CLI_SESSION_STATE =
        originalSessionState;
    }
  });

  it('shows the current mode and cold-restarts after switching to fallback fonts', async () => {
    if (Platform.OS === 'web') return;
    const { getByTestId, getByText } = await render(<ExpoPreviewReadiness />);

    await waitFor(() => {
      expect(getByTestId('font-mode-status').props.children).toEqual([
        'Font mode:',
        ' ',
        'Inter',
      ]);
    });
    expect(getByText('Changing this setting requires a cold restart.')).toBeTruthy();
    fireEvent.press(getByTestId('toggle-fallback-fonts'));

    await waitFor(() => {
      expect(mockSetDevFallbackFonts).toHaveBeenCalledWith(true);
      expect(mockReloadAppAsync).toHaveBeenCalledTimes(1);
      expect(getByText('Font mode: System fallback fonts')).toBeTruthy();
    });
  });

  it('shows fallback mode and allows switching back to Inter', async () => {
    if (Platform.OS === 'web') return;
    mockReadDevFallbackFonts.mockResolvedValue(true);
    const { getByTestId, getByText } = await render(<ExpoPreviewReadiness />);

    await waitFor(() => {
      expect(getByText('Font mode: System fallback fonts')).toBeTruthy();
    });
    fireEvent.press(getByTestId('toggle-fallback-fonts'));

    await waitFor(() => {
      expect(mockSetDevFallbackFonts).toHaveBeenCalledWith(false);
      expect(mockReloadAppAsync).toHaveBeenCalledTimes(1);
    });
  });

  it('identifies a Metro-forced fallback mode without offering an ineffective switch', async () => {
    if (Platform.OS === 'web') return;
    process.env.EXPO_PUBLIC_SKIP_INTER_LOADING = '1';
    const { getByText, queryByTestId } = await render(
      <ExpoPreviewReadiness />,
    );

    expect(
      getByText('Font mode: System fallback fonts (Metro override)'),
    ).toBeTruthy();
    expect(queryByTestId('toggle-fallback-fonts')).toBeNull();
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
      expect(queryByTestId('toggle-fallback-fonts')).toBeNull();
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