/**
 * Tests: returnTo is preserved through email-verification in the sign-up flow.
 *
 * Scenario: a signed-out user taps a greyed-out safety button on a title page,
 * gets sent to sign-in (with returnTo=/title/456), navigates to sign-up (same
 * returnTo preserved), creates an account, then verifies their email.
 * After successful verification handleVerify must call router.replace with the
 * original title path — not the home screen.
 *
 * Note: these are unit-level tests; the component is rendered with all native
 * dependencies mocked so they run in a plain Node/jsdom environment.
 */

import React from 'react';
import { render, fireEvent, act, waitFor, cleanup } from '@testing-library/react-native';

// ─── Module-level mocks (prefixed "mock*" so Jest hoisting allows them) ───────

// The hooks are jest.fn() so each test can configure fresh return values.
const mockUseAuth = jest.fn();
const mockUseSignUp = jest.fn();
const mockUseLocalSearchParams = jest.fn();
const mockUseRouter = jest.fn();

// Per-test navigation spy — recreated in beforeEach.
let mockReplace: jest.Mock;

// ─── Mock declarations ────────────────────────────────────────────────────────

jest.mock('@clerk/expo', () => ({
  useAuth: (...args: any[]) => mockUseAuth(...args),
  useSignUp: (...args: any[]) => mockUseSignUp(...args),
  Link: ({ children }: any) => children,
  Redirect: () => null,
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: (...args: any[]) => mockUseLocalSearchParams(...args),
  useRouter: (...args: any[]) => mockUseRouter(...args),
  Link: ({ children }: any) => children,
  Redirect: () => null,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
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

// ─── Component import (after mocks) ──────────────────────────────────────────

import SignUpScreen from '../app/(auth)/sign-up';

// ─── Test helpers ─────────────────────────────────────────────────────────────

/**
 * Builds a fresh signUp-like object whose `status` is writable.
 * Pass in the jest.fn() spies you want to capture calls on.
 */
function makeSignUpMock({
  verifyEmailCode,
  finalize,
}: {
  verifyEmailCode: jest.Mock;
  finalize: jest.Mock;
}) {
  return {
    status: 'missing_requirements' as string,
    unverifiedFields: ['email_address'],
    missingFields: [] as string[],
    verifications: {
      verifyEmailCode,
      sendEmailCode: jest.fn(),
    },
    finalize,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SignUpScreen – returnTo forwarding through email verification', () => {
  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  it('navigates to the title page when returnTo is set and verification succeeds', async () => {
    mockReplace = jest.fn();
    const verifyEmailCode = jest.fn();
    const finalize = jest.fn();
    const signUp = makeSignUpMock({ verifyEmailCode, finalize });

    // verifyEmailCode advances signUp to complete
    verifyEmailCode.mockImplementation(async () => {
      signUp.status = 'complete';
    });
    // finalize calls navigate with a simple decorateUrl echo
    finalize.mockImplementation(async ({ navigate }: any) => {
      navigate({ session: {}, decorateUrl: (url: string) => url });
    });

    mockUseAuth.mockReturnValue({ isSignedIn: false });
    mockUseSignUp.mockReturnValue({ signUp, errors: { fields: {} }, fetchStatus: 'idle' });
    mockUseLocalSearchParams.mockReturnValue({ returnTo: '/title/456' });
    mockUseRouter.mockReturnValue({ replace: mockReplace, push: jest.fn() });

    const { getByTestId } = await render(<SignUpScreen />);

    // Component should be in "verifying" state (unverifiedFields contains email_address)
    await act(async () => {
      fireEvent.changeText(getByTestId('code-input'), '123456');
    });

    await act(async () => {
      fireEvent.press(getByTestId('verify-button'));
    });

    await waitFor(() => {
      expect(verifyEmailCode).toHaveBeenCalledWith({ code: '123456' });
    });
    await waitFor(() => {
      expect(finalize).toHaveBeenCalled();
    });

    // Must navigate to the original title, not the home screen
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/title/456');
    });
    expect(mockReplace).not.toHaveBeenCalledWith('/');
  });

  it('falls back to "/" when returnTo is absent and verification succeeds', async () => {
    mockReplace = jest.fn();
    const verifyEmailCode = jest.fn();
    const finalize = jest.fn();
    const signUp = makeSignUpMock({ verifyEmailCode, finalize });

    verifyEmailCode.mockImplementation(async () => {
      signUp.status = 'complete';
    });
    finalize.mockImplementation(async ({ navigate }: any) => {
      navigate({ session: {}, decorateUrl: (url: string) => url });
    });

    mockUseAuth.mockReturnValue({ isSignedIn: false });
    mockUseSignUp.mockReturnValue({ signUp, errors: { fields: {} }, fetchStatus: 'idle' });
    mockUseLocalSearchParams.mockReturnValue({ returnTo: undefined });
    mockUseRouter.mockReturnValue({ replace: mockReplace, push: jest.fn() });

    const { getByTestId } = await render(<SignUpScreen />);

    await act(async () => {
      fireEvent.changeText(getByTestId('code-input'), '654321');
    });
    await act(async () => {
      fireEvent.press(getByTestId('verify-button'));
    });

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/');
    });
  });

  it('does NOT call finalize or navigate when status stays non-complete', async () => {
    mockReplace = jest.fn();
    const verifyEmailCode = jest.fn();
    const finalize = jest.fn();
    const signUp = makeSignUpMock({ verifyEmailCode, finalize });

    // verifyEmailCode resolves but status stays 'missing_requirements'
    verifyEmailCode.mockResolvedValue(undefined);

    mockUseAuth.mockReturnValue({ isSignedIn: false });
    mockUseSignUp.mockReturnValue({ signUp, errors: { fields: {} }, fetchStatus: 'idle' });
    mockUseLocalSearchParams.mockReturnValue({ returnTo: '/title/456' });
    mockUseRouter.mockReturnValue({ replace: mockReplace, push: jest.fn() });

    const { getByTestId } = await render(<SignUpScreen />);

    await act(async () => {
      fireEvent.changeText(getByTestId('code-input'), '000000');
    });
    await act(async () => {
      fireEvent.press(getByTestId('verify-button'));
    });

    await waitFor(() => {
      expect(verifyEmailCode).toHaveBeenCalled();
    });

    expect(finalize).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('preserves a different title ID and does not fall back to home', async () => {
    mockReplace = jest.fn();
    const verifyEmailCode = jest.fn();
    const finalize = jest.fn();
    const signUp = makeSignUpMock({ verifyEmailCode, finalize });

    verifyEmailCode.mockImplementation(async () => {
      signUp.status = 'complete';
    });
    finalize.mockImplementation(async ({ navigate }: any) => {
      navigate({ session: {}, decorateUrl: (url: string) => url });
    });

    mockUseAuth.mockReturnValue({ isSignedIn: false });
    mockUseSignUp.mockReturnValue({ signUp, errors: { fields: {} }, fetchStatus: 'idle' });
    mockUseLocalSearchParams.mockReturnValue({ returnTo: '/title/789' });
    mockUseRouter.mockReturnValue({ replace: mockReplace, push: jest.fn() });

    const { getByTestId } = await render(<SignUpScreen />);

    await act(async () => {
      fireEvent.changeText(getByTestId('code-input'), '111222');
    });
    await act(async () => {
      fireEvent.press(getByTestId('verify-button'));
    });

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/title/789');
    });
    expect(mockReplace).not.toHaveBeenCalledWith('/');
  });

  it('skips navigation when session.currentTask is set (Clerk bot-check gate)', async () => {
    mockReplace = jest.fn();
    const verifyEmailCode = jest.fn();
    const finalize = jest.fn();
    const signUp = makeSignUpMock({ verifyEmailCode, finalize });

    verifyEmailCode.mockImplementation(async () => {
      signUp.status = 'complete';
    });
    // Clerk sets currentTask when a bot-protection step is pending
    finalize.mockImplementation(async ({ navigate }: any) => {
      navigate({
        session: { currentTask: 'captcha' },
        decorateUrl: (url: string) => url,
      });
    });

    mockUseAuth.mockReturnValue({ isSignedIn: false });
    mockUseSignUp.mockReturnValue({ signUp, errors: { fields: {} }, fetchStatus: 'idle' });
    mockUseLocalSearchParams.mockReturnValue({ returnTo: '/title/456' });
    mockUseRouter.mockReturnValue({ replace: mockReplace, push: jest.fn() });

    const { getByTestId } = await render(<SignUpScreen />);

    await act(async () => {
      fireEvent.changeText(getByTestId('code-input'), '999888');
    });
    await act(async () => {
      fireEvent.press(getByTestId('verify-button'));
    });

    await waitFor(() => {
      expect(finalize).toHaveBeenCalled();
    });

    // navigate must return early — router.replace must NOT be called
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
