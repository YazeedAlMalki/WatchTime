import React from 'react';
import { render } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { ExpoPreviewReadiness } from '../components/ExpoPreviewReadiness';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

describe('ExpoPreviewReadiness', () => {
  const originalSessionState =
    process.env.EXPO_PUBLIC_REPLIT_EXPO_CLI_SESSION_STATE;

  afterEach(() => {
    if (originalSessionState === undefined) {
      delete process.env.EXPO_PUBLIC_REPLIT_EXPO_CLI_SESSION_STATE;
    } else {
      process.env.EXPO_PUBLIC_REPLIT_EXPO_CLI_SESSION_STATE =
        originalSessionState;
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