import React, { useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAuth, useSignUp } from '@clerk/expo';
import { Link, Redirect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DevAuthForm } from '@/components/DevAuthForm';
import { isDevelopmentAuthEnabled } from '@workspace/dev-auth';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useColors } from '@/hooks/useColors';
import colors from '@/constants/colors';

const isDevelopmentBuild = isDevelopmentAuthEnabled(
  __DEV__ ? 'development' : 'production',
);

export default function SignUpScreen() {
  if (isDevelopmentBuild) return <DevAuthForm mode="sign-up" />;
  return <ClerkSignUpScreen />;
}

function ClerkSignUpScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isSignedIn } = useAuth();
  const { signUp, errors, fetchStatus } = useSignUp();
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();

  const [emailAddress, setEmailAddress] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [resendStatus, setResendStatus] = useState<{ message: string; failed: boolean } | null>(null);
  const [resending, setResending] = useState(false);

  const busy = fetchStatus === 'fetching';

  const handleResend = async () => {
    if (busy || resending) return;
    setResending(true);
    setResendStatus(null);
    try {
      const { error } = await signUp.verifications.sendEmailCode();
      setResendStatus(error
        ? { message: `Could not send a new code. ${error.message || 'Please try again.'}`, failed: true }
        : { message: 'A new code is on its way. Check your email.', failed: false });
    } catch {
      setResendStatus({ message: 'Could not send a new code. Please try again.', failed: true });
    } finally {
      setResending(false);
    }
  };

  const handleSubmit = async () => {
    const { error } = await signUp.password({ emailAddress, password });
    if (!error) await signUp.verifications.sendEmailCode();
  };

  const handleVerify = async () => {
    const { error } = await signUp.verifications.verifyEmailCode({ code });
    if (error) return;
    if (signUp.status === 'complete') {
      const dest = (returnTo as string | undefined) ?? '/';
      await signUp.finalize({
        navigate: ({ session, decorateUrl }: any) => {
          if (session?.currentTask) return;
          const url = decorateUrl(dest);
          if (typeof url === 'string' && url.startsWith('http')) {
            if (Platform.OS === 'web') window.location.href = url;
            else router.replace(dest as Href);
          } else {
            router.replace(url as Href);
          }
        },
      });
    }
  };

  if (signUp.status === 'complete' || isSignedIn) return <Redirect href="/" />;

  const verifying =
    signUp.status === 'missing_requirements' &&
    signUp.unverifiedFields.includes('email_address') &&
    signUp.missingFields.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          padding: 24,
          paddingTop: (Platform.OS === 'web' ? 67 : insets.top) + 24,
          paddingBottom: (Platform.OS === 'web' ? 34 : insets.bottom) + 24,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ alignItems: 'center', marginBottom: 32 }}>
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 18,
              backgroundColor: c.primary,
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16,
            }}
          >
            <Feather name={verifying ? 'mail' : 'user-plus'} size={28} color={c.primaryForeground} />
          </View>
          <Text style={{ color: c.foreground, fontSize: 26, fontFamily: 'Inter_700Bold' }}>
            {verifying ? 'Check your email' : 'Create your account'}
          </Text>
          <Text
            style={{
              color: c.mutedForeground,
              fontSize: 15,
              fontFamily: 'Inter_400Regular',
              marginTop: 6,
              textAlign: 'center',
            }}
          >
            {verifying
              ? `We sent a verification code to ${emailAddress}`
              : 'Track shows, movies and more'}
          </Text>
        </View>

        {verifying ? (
          <>
            <TextInput
              testID="code-input"
              style={[styles.input, { backgroundColor: c.card, borderColor: c.border, color: c.foreground }]}
              value={code}
              placeholder="Verification code"
              placeholderTextColor={c.mutedForeground}
              onChangeText={setCode}
              keyboardType="numeric"
            />
            {errors.fields.code ? (
              <Text style={{ color: c.destructive, fontSize: 13, marginBottom: 8 }}>
                {errors.fields.code.message}
              </Text>
            ) : null}
            <Pressable
              testID="verify-button"
              onPress={handleVerify}
              disabled={busy || !code}
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: c.primary, opacity: busy || !code ? 0.5 : pressed ? 0.8 : 1 },
              ]}
            >
              <Text style={{ color: c.primaryForeground, fontSize: 16, fontFamily: 'Inter_600SemiBold' }}>
                {busy ? 'Verifying…' : 'Verify'}
              </Text>
            </Pressable>
            <Pressable
              testID="resend-code-button"
              onPress={handleResend}
              disabled={busy || resending}
              style={({ pressed }) => [{ alignItems: 'center', marginTop: 16, opacity: busy || resending ? 0.5 : pressed ? 0.6 : 1 }]}
            >
              <Text style={{ color: c.primary, fontFamily: 'Inter_500Medium' }}>
                {resending ? 'Sending…' : 'I need a new code'}
              </Text>
            </Pressable>
            {resendStatus ? (
              <Text
                testID="resend-code-status"
                accessibilityLiveRegion="polite"
                style={{ color: resendStatus.failed ? c.destructive : c.mutedForeground, fontSize: 13, textAlign: 'center', marginTop: 8 }}
              >
                {resendStatus.message}
              </Text>
            ) : null}
          </>
        ) : (
          <>
            <TextInput
              testID="email-input"
              style={[styles.input, { backgroundColor: c.card, borderColor: c.border, color: c.foreground }]}
              autoCapitalize="none"
              value={emailAddress}
              placeholder="Email address"
              placeholderTextColor={c.mutedForeground}
              onChangeText={setEmailAddress}
              keyboardType="email-address"
            />
            {errors.fields.emailAddress ? (
              <Text style={{ color: c.destructive, fontSize: 13, marginBottom: 8 }}>
                {errors.fields.emailAddress.message}
              </Text>
            ) : null}
            <TextInput
              testID="password-input"
              style={[styles.input, { backgroundColor: c.card, borderColor: c.border, color: c.foreground }]}
              value={password}
              placeholder="Password"
              placeholderTextColor={c.mutedForeground}
              secureTextEntry
              onChangeText={setPassword}
            />
            {errors.fields.password ? (
              <Text style={{ color: c.destructive, fontSize: 13, marginBottom: 8 }}>
                {errors.fields.password.message}
              </Text>
            ) : null}
            <Pressable
              testID="sign-up-button"
              onPress={handleSubmit}
              disabled={!emailAddress || !password || busy}
              style={({ pressed }) => [
                styles.button,
                {
                  backgroundColor: c.primary,
                  opacity: !emailAddress || !password || busy ? 0.5 : pressed ? 0.8 : 1,
                },
              ]}
            >
              <Text style={{ color: c.primaryForeground, fontSize: 16, fontFamily: 'Inter_600SemiBold' }}>
                {busy ? 'Creating account…' : 'Sign up'}
              </Text>
            </Pressable>
          </>
        )}

        <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 24 }}>
          <Text style={{ color: c.mutedForeground, fontFamily: 'Inter_400Regular' }}>
            Already have an account?{' '}
          </Text>
          <Link href={returnTo ? { pathname: '/(auth)/sign-in', params: { returnTo } } : '/(auth)/sign-in'}>
            <Text style={{ color: c.primary, fontFamily: 'Inter_600SemiBold' }}>Sign in</Text>
          </Link>
        </View>

        <View nativeID="clerk-captcha" />
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderRadius: colors.radius,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    marginBottom: 12,
  },
  button: {
    borderRadius: colors.radius,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
});