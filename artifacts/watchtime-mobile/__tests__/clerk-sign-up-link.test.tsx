import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockUseLocalSearchParams = jest.fn();
const mockUseSignUp = jest.fn();
const mockLinkHref = jest.fn();
const mockRouterReplace = jest.fn();
const mockRedirect = jest.fn();

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
  Redirect: (props: unknown) => {
    mockRedirect(props);
    return null;
  },
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

  it.each(['returned error', 'rejected promise'])('recovers from a finalization failure: %s', async (failure) => {
    mockUseLocalSearchParams.mockReturnValue({ returnTo: '/title/456' });
    const signUp = {
      status: 'missing_requirements',
      unverifiedFields: ['email_address'],
      missingFields: [],
      verifications: { verifyEmailCode: jest.fn() },
      finalize: jest.fn(),
    };
    signUp.verifications.verifyEmailCode.mockImplementation(async () => {
      signUp.status = 'complete';
      return { error: null };
    });
    const privateError = 'Internal activation details must not be displayed';
    if (failure === 'returned error') {
      signUp.finalize.mockResolvedValueOnce({ error: { message: privateError } });
    } else {
      signUp.finalize.mockRejectedValueOnce(new Error(privateError));
    }
    mockUseSignUp.mockImplementation(() => ({ signUp, errors: { fields: {} }, fetchStatus: 'idle' }));

    const screen = await render(<SignUpScreen />);
    await fireEvent.changeText(screen.getByTestId('code-input'), '123456');
    await fireEvent.press(screen.getByTestId('verify-button'));

    await waitFor(() => expect(screen.getByTestId('finalization-error').props.children).toBe(
      'Your email is verified, but we could not finish signing you in. Try again, or use Sign in below.',
    ));
    await screen.rerender(<SignUpScreen />);
    expect(screen.getByText('Finish signing in')).toBeTruthy();
    expect(screen.queryByTestId('code-input')).toBeNull();
    expect(screen.queryByText(privateError)).toBeNull();
    expect(mockRouterReplace).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(screen.getByTestId('retry-finalization-button').props.accessibilityState.disabled).toBe(false);
    expect(screen.getByText('Sign in')).toBeTruthy();
    expect(mockLinkHref).toHaveBeenLastCalledWith({
      pathname: '/(auth)/sign-in',
      params: { returnTo: '/title/456' },
    });

    signUp.finalize.mockImplementationOnce(async ({ navigate }: { navigate: (args: unknown) => void }) => {
      navigate({ session: { currentTask: null }, decorateUrl: (url: string) => `${url}?verified=1` });
      return { error: null };
    });
    await fireEvent.press(screen.getByTestId('retry-finalization-button'));

    await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith('/title/456?verified=1'));
    expect(screen.queryByTestId('finalization-error')).toBeNull();
    expect(signUp.verifications.verifyEmailCode).toHaveBeenCalledTimes(1);
    expect(signUp.finalize).toHaveBeenCalledTimes(2);
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

  it.each(['returned error', 'rejected promise'])('recovers when the initial email code was not sent: %s', async (failure) => {
    mockUseLocalSearchParams.mockReturnValue({ returnTo: '/title/456' });
    const sendEmailCode = jest.fn();
    if (failure === 'returned error') {
      sendEmailCode.mockResolvedValueOnce({ error: { message: 'Email service unavailable.' } });
    } else {
      sendEmailCode.mockRejectedValueOnce(new Error('Email service unavailable.'));
    }
    sendEmailCode.mockResolvedValueOnce({ error: null });
    const signUp = {
      status: 'missing_requirements',
      unverifiedFields: [] as string[],
      missingFields: ['email_address', 'password'],
      password: jest.fn(async () => {
        signUp.unverifiedFields = ['email_address'];
        signUp.missingFields = [];
        return { error: null };
      }),
      verifications: {
        sendEmailCode,
        verifyEmailCode: jest.fn(async () => {
          signUp.status = 'complete';
          return { error: null };
        }),
      },
      finalize: jest.fn(async ({ navigate }: { navigate: (args: unknown) => void }) => {
        navigate({ session: { currentTask: null }, decorateUrl: (url: string) => url });
      }),
    };
    mockUseSignUp.mockImplementation(() => ({ signUp, errors: { fields: {} }, fetchStatus: 'idle' }));

    const screen = await render(<SignUpScreen />);
    await fireEvent.changeText(screen.getByTestId('email-input'), 'viewer@example.com');
    await fireEvent.changeText(screen.getByTestId('password-input'), 'test-password');
    await fireEvent.press(screen.getByTestId('sign-up-button'));

    await waitFor(() => expect(screen.getByTestId('resend-code-status').props.children).toBe(
      'Could not send your verification code. Tap “I need a new code” below to try again.',
    ));
    expect(screen.queryByText('We sent a verification code to viewer@example.com')).toBeNull();
    expect(screen.getByText('Verify your email address: viewer@example.com')).toBeTruthy();
    expect(screen.getByTestId('code-input')).toBeTruthy();
    expect(screen.getByTestId('resend-code-button').props.accessibilityState.disabled).toBe(false);
    expect(signUp.password).toHaveBeenCalledWith({
      emailAddress: 'viewer@example.com', password: 'test-password',
    });
    expect(signUp.finalize).not.toHaveBeenCalled();
    expect(mockRouterReplace).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('resend-code-button'));
    await waitFor(() => expect(screen.getByTestId('resend-code-status').props.children)
      .toBe('A new code is on its way. Check your email.'));
    expect(screen.getByText('We sent a verification code to viewer@example.com')).toBeTruthy();
    expect(sendEmailCode).toHaveBeenCalledTimes(2);
    expect(signUp.password).toHaveBeenCalledTimes(1);

    await fireEvent.changeText(screen.getByTestId('code-input'), '654321');
    await fireEvent.press(screen.getByTestId('verify-button'));
    await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith('/title/456'));
    expect(signUp.verifications.verifyEmailCode).toHaveBeenCalledWith({ code: '654321' });
    expect(signUp.finalize).toHaveBeenCalledTimes(1);
  });

  it('confirms delivery only after the initial email code send succeeds', async () => {
    mockUseLocalSearchParams.mockReturnValue({});
    const signUp = {
      status: 'missing_requirements',
      unverifiedFields: [] as string[],
      missingFields: ['email_address', 'password'],
      password: jest.fn(async () => {
        signUp.unverifiedFields = ['email_address'];
        signUp.missingFields = [];
        return { error: null };
      }),
      verifications: { sendEmailCode: jest.fn().mockResolvedValue({ error: null }) },
    };
    mockUseSignUp.mockImplementation(() => ({ signUp, errors: { fields: {} }, fetchStatus: 'idle' }));

    const screen = await render(<SignUpScreen />);
    await fireEvent.changeText(screen.getByTestId('email-input'), 'viewer@example.com');
    await fireEvent.changeText(screen.getByTestId('password-input'), 'test-password');
    await fireEvent.press(screen.getByTestId('sign-up-button'));

    await waitFor(() => expect(screen.getByText('We sent a verification code to viewer@example.com')).toBeTruthy());
    expect(screen.queryByTestId('resend-code-status')).toBeNull();
    expect(signUp.verifications.sendEmailCode).toHaveBeenCalledTimes(1);
  });

  it.each(['success', 'returned error', 'rejected promise'])(
    'blocks verification while resending and restores it after %s',
    async (outcome) => {
      mockUseLocalSearchParams.mockReturnValue({ returnTo: '/title/456' });
      let resolveSend!: (value: { error: null | { message: string } }) => void;
      let rejectSend!: (reason: Error) => void;
      const sendEmailCode = jest.fn(() => new Promise<{ error: null | { message: string } }>((resolve, reject) => {
        resolveSend = resolve;
        rejectSend = reject;
      }));
      const signUp = {
        status: 'missing_requirements',
        unverifiedFields: ['email_address'],
        missingFields: [],
        verifications: {
          sendEmailCode,
          verifyEmailCode: jest.fn(async () => {
            signUp.status = 'complete';
            return { error: null };
          }),
        },
        finalize: jest.fn(async ({ navigate }: { navigate: (args: unknown) => void }) => {
          navigate({ session: { currentTask: null }, decorateUrl: (url: string) => url });
        }),
      };
      // Clerk can remain idle while our separate resend promise is pending.
      mockUseSignUp.mockImplementation(() => ({ signUp, errors: { fields: {} }, fetchStatus: 'idle' }));

      const screen = await render(<SignUpScreen />);
      // The renderer exposes host nodes, so find the enclosing Pressable's
      // callback to test its guard independently of native disabled behavior.
      const getPressHandler = (testID: string) => {
        let fiber = screen.getByTestId(testID).unstable_fiber;
        while (fiber) {
          if (typeof fiber.memoizedProps?.onPress === 'function') return fiber.memoizedProps.onPress;
          fiber = fiber.return;
        }
        throw new Error(`No press handler found for ${testID}`);
      };
      await fireEvent.changeText(screen.getByTestId('code-input'), '123456');
      expect(screen.getByTestId('verify-button')).toBeEnabled();
      // Do not await the resend handler: its request must stay pending.
      await act(async () => {
        void getPressHandler('resend-code-button')();
      });

      expect(sendEmailCode).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('verify-button')).toBeDisabled();
      await fireEvent.press(screen.getByTestId('verify-button'));
      // Also bypass the disabled control to exercise the handler's own guard.
      await act(async () => {
        await getPressHandler('verify-button')();
      });
      expect(signUp.verifications.verifyEmailCode).not.toHaveBeenCalled();
      expect(signUp.finalize).not.toHaveBeenCalled();
      expect(mockRouterReplace).not.toHaveBeenCalled();

      await act(async () => {
        if (outcome === 'rejected promise') {
          rejectSend(new Error('Email service unavailable.'));
        } else {
          resolveSend({ error: outcome === 'returned error' ? { message: 'Please try again.' } : null });
        }
      });

      expect(screen.getByTestId('verify-button')).toBeEnabled();
      expect(screen.getByTestId('resend-code-button')).toBeEnabled();
      expect(signUp.verifications.verifyEmailCode).not.toHaveBeenCalled();
      expect(signUp.finalize).not.toHaveBeenCalled();
      await fireEvent.changeText(screen.getByTestId('code-input'), '654321');
      await fireEvent.press(screen.getByTestId('verify-button'));

      await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith('/title/456'));
      expect(signUp.verifications.verifyEmailCode).toHaveBeenCalledTimes(1);
      expect(signUp.verifications.verifyEmailCode).toHaveBeenCalledWith({ code: '654321' });
      expect(signUp.finalize).toHaveBeenCalledTimes(1);
    },
  );

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

  it('recovers when a resend promise is rejected and verifies at the requested destination', async () => {
    mockUseLocalSearchParams.mockReturnValue({ returnTo: '/title/456' });
    const sendEmailCode = jest.fn()
      .mockResolvedValueOnce({ error: null })
      .mockRejectedValueOnce(new Error('Network request failed'))
      .mockResolvedValueOnce({ error: null });
    const signUp = {
      status: 'missing_requirements',
      unverifiedFields: [] as string[],
      missingFields: ['email_address', 'password'],
      password: jest.fn(async () => {
        signUp.unverifiedFields = ['email_address'];
        signUp.missingFields = [];
        return { error: null };
      }),
      verifications: {
        sendEmailCode,
        verifyEmailCode: jest.fn(async () => {
          signUp.status = 'complete';
          return { error: null };
        }),
      },
      finalize: jest.fn(async ({ navigate }: { navigate: (args: unknown) => void }) => {
        navigate({ session: { currentTask: null }, decorateUrl: (url: string) => url });
      }),
    };
    mockUseSignUp.mockImplementation(() => ({ signUp, errors: { fields: {} }, fetchStatus: 'idle' }));

    const screen = await render(<SignUpScreen />);
    await fireEvent.changeText(screen.getByTestId('email-input'), 'viewer@example.com');
    await fireEvent.changeText(screen.getByTestId('password-input'), 'test-password');
    await fireEvent.press(screen.getByTestId('sign-up-button'));
    await waitFor(() => expect(screen.getByText('We sent a verification code to viewer@example.com')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('resend-code-button'));
    await waitFor(() => expect(screen.getByTestId('resend-code-status').props.children)
      .toBe('Could not send a new code. Please try again.'));

    expect(screen.getByText('Check your email')).toBeTruthy();
    expect(screen.getByTestId('code-input')).toBeTruthy();
    expect(screen.getByTestId('resend-code-button').props.accessibilityState.disabled).toBe(false);
    expect(mockLinkHref).toHaveBeenCalledWith({
      pathname: '/(auth)/sign-in',
      params: { returnTo: '/title/456' },
    });
    expect(sendEmailCode).toHaveBeenCalledTimes(2);
    expect(mockRouterReplace).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('resend-code-button'));
    await waitFor(() => expect(screen.getByTestId('resend-code-status').props.children)
      .toBe('A new code is on its way. Check your email.'));
    expect(sendEmailCode).toHaveBeenCalledTimes(3);
    expect(screen.getByText('We sent a verification code to viewer@example.com')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('code-input'), '654321');
    await fireEvent.press(screen.getByTestId('verify-button'));
    await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith('/title/456'));
    expect(signUp.verifications.verifyEmailCode).toHaveBeenCalledWith({ code: '654321' });
    expect(signUp.finalize).toHaveBeenCalledTimes(1);
  });

  it('accepts a resent email code on the same screen after a rejected attempt', async () => {
    mockUseLocalSearchParams.mockReturnValue({ returnTo: '/title/456' });
    const errors: { fields: { code?: { message: string } } } = { fields: {} };
    let newCodeSent = false;
    const sendEmailCode = jest.fn(async () => {
      newCodeSent = true;
      delete errors.fields.code;
      return { error: null };
    });
    const signUp = {
      status: 'missing_requirements',
      unverifiedFields: ['email_address'],
      missingFields: [],
      verifications: { verifyEmailCode: jest.fn(), sendEmailCode },
      finalize: jest.fn(),
    };
    signUp.verifications.verifyEmailCode.mockImplementation(async ({ code }: { code: string }) => {
      if (!newCodeSent || code !== '654321') {
        errors.fields.code = { message: 'That verification code has expired.' };
        return { error: errors.fields.code };
      }
      delete errors.fields.code;
      signUp.status = 'complete';
      return { error: null };
    });
    const decorateUrl = jest.fn((url: string) => `${url}?verified=1`);
    signUp.finalize.mockImplementation(async ({ navigate }: { navigate: (args: unknown) => void }) => {
      navigate({ session: { currentTask: null }, decorateUrl });
    });
    mockUseSignUp.mockImplementation(() => ({ signUp, errors, fetchStatus: 'idle' }));

    const screen = await render(<SignUpScreen />);
    await fireEvent.changeText(screen.getByTestId('code-input'), '000000');
    await fireEvent.press(screen.getByTestId('verify-button'));
    await waitFor(() => expect(signUp.verifications.verifyEmailCode).toHaveBeenCalledWith({ code: '000000' }));
    await screen.rerender(<SignUpScreen />);

    expect(screen.getByText('That verification code has expired.')).toBeTruthy();
    expect(signUp.finalize).not.toHaveBeenCalled();
    expect(mockRouterReplace).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('resend-code-button'));
    await waitFor(() => expect(screen.getByTestId('resend-code-status').props.children)
      .toBe('A new code is on its way. Check your email.'));

    expect(sendEmailCode).toHaveBeenCalledTimes(1);
    expect(sendEmailCode).toHaveBeenCalledWith();
    expect(screen.getByText('Check your email')).toBeTruthy();
    expect(screen.getByTestId('code-input').props.value).toBe('000000');
    expect(screen.queryByText('That verification code has expired.')).toBeNull();
    expect(signUp.verifications.verifyEmailCode).toHaveBeenCalledTimes(1);
    expect(signUp.finalize).not.toHaveBeenCalled();
    expect(mockRouterReplace).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId('code-input'), '654321');
    await fireEvent.press(screen.getByTestId('verify-button'));

    await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith('/title/456?verified=1'));
    expect(signUp.verifications.verifyEmailCode.mock.calls).toEqual([
      [{ code: '000000' }],
      [{ code: '654321' }],
    ]);
    expect(signUp.finalize).toHaveBeenCalledTimes(1);
    expect(signUp.finalize).toHaveBeenCalledWith({ navigate: expect.any(Function) });
    expect(decorateUrl).toHaveBeenCalledTimes(1);
    expect(decorateUrl).toHaveBeenCalledWith('/title/456');
    expect(mockRouterReplace).toHaveBeenCalledTimes(1);
    await screen.rerender(<SignUpScreen />);
    expect(errors.fields.code).toBeUndefined();
    expect(screen.queryByText('That verification code has expired.')).toBeNull();
  });

  it('accepts a corrected email code on the same screen after a rejected attempt', async () => {
    mockUseLocalSearchParams.mockReturnValue({ returnTo: '/title/456' });
    const errors: { fields: { code?: { message: string } } } = { fields: {} };
    const signUp = {
      status: 'missing_requirements',
      unverifiedFields: ['email_address'],
      missingFields: [],
      verifications: { verifyEmailCode: jest.fn() },
      finalize: jest.fn(),
    };
    signUp.verifications.verifyEmailCode.mockImplementation(async ({ code }: { code: string }) => {
      if (code === '000000') {
        errors.fields.code = { message: 'That verification code is invalid.' };
        return { error: errors.fields.code };
      }
      delete errors.fields.code;
      signUp.status = 'complete';
      return { error: null };
    });
    const decorateUrl = jest.fn((url: string) => `${url}?verified=1`);
    signUp.finalize.mockImplementation(async ({ navigate }: { navigate: (args: unknown) => void }) => {
      navigate({ session: { currentTask: null }, decorateUrl });
    });
    mockUseSignUp.mockImplementation(() => ({ signUp, errors, fetchStatus: 'idle' }));

    const screen = await render(<SignUpScreen />);
    await fireEvent.changeText(screen.getByTestId('code-input'), '000000');
    await fireEvent.press(screen.getByTestId('verify-button'));
    await waitFor(() => expect(signUp.verifications.verifyEmailCode).toHaveBeenCalledWith({ code: '000000' }));
    await screen.rerender(<SignUpScreen />);

    expect(screen.getByText('That verification code is invalid.')).toBeTruthy();
    expect(screen.getByTestId('code-input')).toBeTruthy();
    expect(signUp.finalize).not.toHaveBeenCalled();
    expect(mockRouterReplace).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId('code-input'), '123456');
    await fireEvent.press(screen.getByTestId('verify-button'));

    await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith('/title/456?verified=1'));
    expect(signUp.verifications.verifyEmailCode.mock.calls).toEqual([
      [{ code: '000000' }],
      [{ code: '123456' }],
    ]);
    expect(signUp.finalize).toHaveBeenCalledTimes(1);
    expect(decorateUrl).toHaveBeenCalledWith('/title/456');
    await screen.rerender(<SignUpScreen />);
    expect(errors.fields.code).toBeUndefined();
    expect(screen.queryByText('That verification code is invalid.')).toBeNull();
  });
});
