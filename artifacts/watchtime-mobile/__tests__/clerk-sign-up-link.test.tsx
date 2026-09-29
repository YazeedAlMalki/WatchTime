import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockUseLocalSearchParams = jest.fn();
const mockUseSignUp = jest.fn();
const mockLinkHref = jest.fn();
const mockRouterReplace = jest.fn();

jest.mock('@workspace/dev-auth', () => ({
  isDevelopmentAuthEnabled: () => false,
}));

jest.mock('@clerk/expo', () => ({
  useAuth: () => ({ isSignedIn: false }),
  useSignUp: (...args: unknown[]) => mockUseSignUp(...args),
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: (...args: unknown[]) => mockUseLocalSearchParams(...args),
  useRouter: () => ({ replace: mockRouterReplace }),
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

  it.each([
    { params: { returnTo: '/title/456' }, destination: '/title/456', decorated: '/title/456?verified=1' },
    { params: {}, destination: '/', decorated: '/' },
  ])('finalizes email verification and navigates to $destination', async ({ params, destination, decorated }) => {
    mockUseLocalSearchParams.mockReturnValue(params);
    const verifyEmailCode = jest.fn(async () => {
      signUp.status = 'complete';
      return { error: null };
    });
    const decorateUrl = jest.fn((_url: string) => decorated);
    const finalize = jest.fn(async ({ navigate }: { navigate: (args: unknown) => void }) => {
      navigate({ session: { currentTask: null }, decorateUrl });
    });
    const signUp = {
      status: 'missing_requirements',
      unverifiedFields: ['email_address'],
      missingFields: [],
      verifications: { verifyEmailCode },
      finalize,
    };
    mockUseSignUp.mockReturnValue({
      signUp,
      errors: { fields: {} },
      fetchStatus: 'idle',
    });

    const screen = await render(<SignUpScreen />);
    await fireEvent.changeText(screen.getByTestId('code-input'), '123456');
    await fireEvent.press(screen.getByTestId('verify-button'));

    await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith(decorated));
    expect(verifyEmailCode).toHaveBeenCalledWith({ code: '123456' });
    expect(finalize).toHaveBeenCalledWith({ navigate: expect.any(Function) });
    expect(decorateUrl).toHaveBeenCalledWith(destination);
  });

  it('keeps a rejected email code on the verification screen without finalizing', async () => {
    mockUseLocalSearchParams.mockReturnValue({ returnTo: '/title/456' });
    const errors: { fields: { code?: { message: string } } } = { fields: {} };
    const verifyEmailCode = jest.fn(async () => {
      errors.fields.code = { message: 'That verification code is invalid.' };
      return { error: errors.fields.code };
    });
    const finalize = jest.fn();
    const signUp = {
      status: 'missing_requirements',
      unverifiedFields: ['email_address'],
      missingFields: [],
      verifications: { verifyEmailCode },
      finalize,
    };
    mockUseSignUp.mockImplementation(() => ({
      signUp,
      errors,
      fetchStatus: 'idle',
    }));

    const screen = await render(<SignUpScreen />);
    await fireEvent.changeText(screen.getByTestId('code-input'), '000000');
    await fireEvent.press(screen.getByTestId('verify-button'));
    await waitFor(() => {
      expect(verifyEmailCode).toHaveBeenCalledWith({ code: '000000' });
      expect(errors.fields.code).toEqual({ message: 'That verification code is invalid.' });
    });
    await screen.rerender(<SignUpScreen />);

    expect(screen.getByText('Check your email')).toBeTruthy();
    expect(screen.getByTestId('code-input')).toBeTruthy();
    expect(screen.getByText('That verification code is invalid.')).toBeTruthy();
    expect(finalize).not.toHaveBeenCalled();
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });

  it('reports a failed resend and lets the user retry without leaving verification', async () => {
    mockUseLocalSearchParams.mockReturnValue({});
    const sendEmailCode = jest.fn()
      .mockResolvedValueOnce({ error: { message: 'Please wait before requesting another code.' } })
      .mockResolvedValueOnce({ error: null });
    mockUseSignUp.mockReturnValue({
      signUp: {
        status: 'missing_requirements',
        unverifiedFields: ['email_address'],
        missingFields: [],
        verifications: { sendEmailCode },
      },
      errors: { fields: {} },
      fetchStatus: 'idle',
    });

    const screen = await render(<SignUpScreen />);
    await fireEvent.press(screen.getByTestId('resend-code-button'));
    await waitFor(() => expect(screen.getByTestId('resend-code-status').props.children)
      .toBe('Could not send a new code. Please wait before requesting another code.'));
    expect(screen.getByText('Check your email')).toBeTruthy();
    expect(screen.getByTestId('code-input')).toBeTruthy();
    expect(mockRouterReplace).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('resend-code-button'));
    await waitFor(() => expect(screen.getByTestId('resend-code-status').props.children)
      .toBe('A new code is on its way. Check your email.'));
    expect(sendEmailCode).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('code-input')).toBeTruthy();
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });
});