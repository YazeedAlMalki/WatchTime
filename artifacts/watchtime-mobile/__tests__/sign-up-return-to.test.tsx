/**
 * Development demo authentication contract.
 *
 * The auth screens intentionally do not call Clerk. A valid submission only
 * navigates locally, while an invalid submission stays on the form.
 */

import React from 'react';
import { render, fireEvent, act, cleanup } from '@testing-library/react-native';
import {
  DEV_DEMO_EMAIL,
  DEV_DEMO_PASSWORD,
} from '@workspace/dev-auth';

const mockUseAuth = jest.fn();
const mockUseLocalSearchParams = jest.fn();
const mockUseRouter = jest.fn();
let mockReplace: jest.Mock;
let mockLinkHref: unknown;

jest.mock('@clerk/expo', () => ({
  useAuth: (...args: any[]) => mockUseAuth(...args),
  Redirect: () => null,
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: (...args: any[]) => mockUseLocalSearchParams(...args),
  useRouter: (...args: any[]) => mockUseRouter(...args),
  Link: ({ children, href }: any) => {
    mockLinkHref = href;
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
  KeyboardAwareScrollViewCompat: ({ children }: any) => children,
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
import SignUpScreen from '../app/(auth)/sign-up';

describe('development demo authentication', () => {
  beforeEach(() => {
    mockReplace = jest.fn();
    mockLinkHref = undefined;
    mockUseAuth.mockReturnValue({ isSignedIn: false });
    mockUseLocalSearchParams.mockReturnValue({ returnTo: '/title/456' });
    mockUseRouter.mockReturnValue({ replace: mockReplace, push: jest.fn() });
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  it('shows a validation message and does not navigate for invalid sign-up credentials', async () => {
    const { getByTestId, queryByTestId } = await render(<SignUpScreen />);

    await act(async () => {
      fireEvent.changeText(getByTestId('email-input'), 'wrong@example.com');
      fireEvent.changeText(getByTestId('password-input'), 'wrong-password');
    });
    await act(async () => {
      fireEvent.press(getByTestId('sign-up-button'));
    });

    expect(getByTestId('auth-error')).toBeTruthy();
    expect(queryByTestId('auth-error')?.props.children).toContain('incorrect');
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('accepts the demo credentials and returns to the requested title', async () => {
    const { getByTestId } = await render(<SignInScreen />);

    await act(async () => {
      fireEvent.changeText(getByTestId('email-input'), DEV_DEMO_EMAIL);
      fireEvent.changeText(getByTestId('password-input'), DEV_DEMO_PASSWORD);
    });
    await act(async () => {
      fireEvent.press(getByTestId('sign-in-button'));
    });

    expect(mockReplace).toHaveBeenCalledWith('/title/456');
  });

  it('falls back to home after a valid demo submission without returnTo', async () => {
    mockUseLocalSearchParams.mockReturnValue({ returnTo: undefined });
    const { getByTestId } = await render(<SignUpScreen />);

    await act(async () => {
      fireEvent.changeText(getByTestId('email-input'), DEV_DEMO_EMAIL);
      fireEvent.changeText(getByTestId('password-input'), DEV_DEMO_PASSWORD);
    });
    await act(async () => {
      fireEvent.press(getByTestId('sign-up-button'));
    });

    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  it('preserves returnTo when switching from sign-up to sign-in', async () => {
    await render(<SignUpScreen />);

    expect(mockLinkHref).toEqual({
      pathname: '/(auth)/sign-in',
      params: { returnTo: '/title/456' },
    });
  });
});