import React from 'react';
import { cleanup, render } from '@testing-library/react-native';

const mockUseLocalSearchParams = jest.fn();
const mockUseSignUp = jest.fn();
const mockLinkHref = jest.fn();

jest.mock('@workspace/dev-auth', () => ({
  isDevelopmentAuthEnabled: () => false,
}));

jest.mock('@clerk/expo', () => ({
  useAuth: () => ({ isSignedIn: false }),
  useSignUp: (...args: unknown[]) => mockUseSignUp(...args),
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: (...args: unknown[]) => mockUseLocalSearchParams(...args),
  useRouter: () => ({ replace: jest.fn() }),
  Link: ({ children, href }: { children: React.ReactNode; href: unknown }) => {
    mockLinkHref(href);
    return children;
  },
  Redirect: () => null,
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

import SignUpScreen from '../app/(auth)/sign-up';

describe('Clerk sign-up switch to sign-in', () => {
  beforeEach(() => {
    mockUseSignUp.mockReturnValue({
      signUp: {
        status: 'missing_requirements',
        unverifiedFields: ['email_address'],
        missingFields: [],
      },
      errors: { fields: {} },
      fetchStatus: 'idle',
    });
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  it('keeps returnTo in the sign-in link on the verification screen', async () => {
    mockUseLocalSearchParams.mockReturnValue({ returnTo: '/title/456' });

    const screen = await render(<SignUpScreen />);

    expect(screen.getByText('Check your email')).toBeTruthy();
    expect(screen.getByTestId('code-input')).toBeTruthy();
    expect(screen.getByText('Sign in')).toBeTruthy();
    expect(mockLinkHref).toHaveBeenCalledWith({
      pathname: '/(auth)/sign-in',
      params: { returnTo: '/title/456' },
    });
  });

  it('omits returnTo on the verification screen when no destination was requested', async () => {
    mockUseLocalSearchParams.mockReturnValue({});

    const screen = await render(<SignUpScreen />);

    expect(screen.getByText('Check your email')).toBeTruthy();
    expect(screen.getByTestId('code-input')).toBeTruthy();
    expect(screen.getByText('Sign in')).toBeTruthy();
    expect(mockLinkHref).toHaveBeenCalledWith('/(auth)/sign-in');
  });

  it('also keeps the sign-in link on the initial sign-up form', async () => {
    mockUseSignUp.mockReturnValue({
      signUp: { status: 'missing_requirements', unverifiedFields: [], missingFields: [] },
      errors: { fields: {} },
      fetchStatus: 'idle',
    });
    mockUseLocalSearchParams.mockReturnValue({ returnTo: '/title/456' });

    const screen = await render(<SignUpScreen />);

    expect(screen.getByText('Create your account')).toBeTruthy();
    expect(screen.getByText('Sign in')).toBeTruthy();
    expect(mockLinkHref).toHaveBeenCalledWith({
      pathname: '/(auth)/sign-in',
      params: { returnTo: '/title/456' },
    });
  });
});