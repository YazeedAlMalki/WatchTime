import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';

const mockUseAuth = jest.fn();
const mockUseLocalSearchParams = jest.fn();
const mockUseRouter = jest.fn();
const mockStartSSOFlow = jest.fn();
const mockSetActive = jest.fn();
const mockReplace = jest.fn();

jest.mock('@workspace/dev-auth', () => ({
  isDevelopmentAuthEnabled: () => false,
}));

jest.mock('@clerk/expo', () => ({
  useAuth: (...args: unknown[]) => mockUseAuth(...args),
  useSignIn: () => ({ signIn: {}, errors: null, fetchStatus: 'idle' }),
  useSSO: () => ({ startSSOFlow: mockStartSSOFlow }),
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: (...args: unknown[]) => mockUseLocalSearchParams(...args),
  useRouter: (...args: unknown[]) => mockUseRouter(...args),
  Link: ({ children }: { children: React.ReactNode }) => children,
  Redirect: () => null,
}));

jest.mock('expo-auth-session', () => ({
  makeRedirectUri: () => 'watchtime://oauth-redirect',
}));

jest.mock('expo-web-browser', () => ({
  maybeCompleteAuthSession: jest.fn(),
  warmUpAsync: jest.fn(),
  coolDownAsync: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@expo/vector-icons', () => ({
  Feather: () => null,
}));

jest.mock('@/components/KeyboardAwareScrollViewCompat', () => ({
  KeyboardAwareScrollViewCompat: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#fff',
    foreground: '#000',
    card: '#f5f5f5',
    border: '#e0e0e0',
    primary: '#6200ee',
    primaryForeground: '#fff',
    mutedForeground: '#666',
    destructive: '#b00020',
  }),
}));

jest.mock('@/constants/colors', () => ({
  default: { radius: 8 },
}));

import SignInScreen from '../app/(auth)/sign-in';

describe('Google sign-in return destination', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ isSignedIn: false });
    mockUseRouter.mockReturnValue({ replace: mockReplace });
    mockStartSSOFlow.mockResolvedValue({
      createdSessionId: 'google-session',
      setActive: mockSetActive,
    });
    mockSetActive.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  async function completeGoogleSignIn() {
    const { getByTestId } = await render(<SignInScreen />);

    await act(async () => {
      fireEvent.press(getByTestId('google-sign-in-button'));
    });

    expect(mockStartSSOFlow).toHaveBeenCalledWith({
      strategy: 'oauth_google',
      redirectUrl: 'watchtime://oauth-redirect',
    });
    expect(mockSetActive).toHaveBeenCalledWith({
      session: 'google-session',
      navigate: expect.any(Function),
    });
    expect(mockReplace).not.toHaveBeenCalled();

    const { navigate } = mockSetActive.mock.calls[0][0];
    await act(async () => {
      await navigate({ session: { currentTask: null } });
    });
  }

  it('returns to the requested show after Google OAuth completes', async () => {
    mockUseLocalSearchParams.mockReturnValue({ returnTo: '/title/123' });

    await completeGoogleSignIn();

    expect(mockReplace).toHaveBeenCalledWith('/title/123');
  });

  it('returns home when no returnTo was provided', async () => {
    mockUseLocalSearchParams.mockReturnValue({});

    await completeGoogleSignIn();

    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  it('shows an accessible error without navigating and lets the user retry Google sign-in', async () => {
    mockUseLocalSearchParams.mockReturnValue({ returnTo: '/title/123' });
    mockStartSSOFlow.mockRejectedValueOnce(new Error('OAuth unavailable'));
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const { getByTestId, queryByTestId } = await render(<SignInScreen />);
      const googleButton = getByTestId('google-sign-in-button');

      await act(async () => {
        fireEvent.press(googleButton);
      });

      const error = getByTestId('google-sign-in-error');
      expect(error.props.accessibilityRole).toBe('alert');
      expect(error.props.accessibilityLiveRegion).toBe('assertive');
      expect(error).toHaveTextContent("Google sign-in couldn't be completed. Please try again.");
      expect(mockSetActive).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
      expect(googleButton.props.accessibilityState?.disabled).not.toBe(true);

      await act(async () => {
        fireEvent.press(googleButton);
      });

      expect(mockStartSSOFlow).toHaveBeenCalledTimes(2);
      expect(queryByTestId('google-sign-in-error')).toBeNull();
      expect(mockSetActive).toHaveBeenCalledWith({
        session: 'google-session',
        navigate: expect.any(Function),
      });
      expect(mockReplace).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});