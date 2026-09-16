import React, { useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Link, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  DEV_DEMO_EMAIL,
  DEV_DEMO_PASSWORD,
  getDevAuthDestination,
  isValidDevDemoCredentials,
} from '@workspace/dev-auth';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useColors } from '@/hooks/useColors';
import { saveDevDemoSession } from '@/lib/dev-demo-session';
import colors from '@/constants/colors';

type AuthMode = 'sign-in' | 'sign-up';

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function DevAuthForm({ mode }: { mode: AuthMode }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { returnTo: rawReturnTo } = useLocalSearchParams<{ returnTo?: string | string[] }>();
  const returnTo = firstParam(rawReturnTo);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const isSignIn = mode === 'sign-in';

  const alternateHref = returnTo
    ? {
        pathname: (isSignIn ? '/(auth)/sign-up' : '/(auth)/sign-in') as Href,
        params: { returnTo },
      }
    : (isSignIn ? '/(auth)/sign-up' : '/(auth)/sign-in');

  async function handleSubmit() {
    if (!isValidDevDemoCredentials(email, password)) {
      setError('That demo email or password is incorrect. Use the credentials shown above.');
      return;
    }
    setError('');
    setIsLoading(true);
    try {
      const base = process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : '';
      const response = await fetch(`${base}/api/dev-auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (
        !response.ok
        || typeof data.token !== 'string'
        || typeof data.expiresIn !== 'number'
      ) {
        throw new Error(response.status === 401
          ? 'That demo email or password is incorrect. Use the credentials shown above.'
          : 'The development demo is unavailable. Please try again.');
      }
      await saveDevDemoSession(data.token, data.expiresIn);
      router.replace(getDevAuthDestination(returnTo) as Href);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to sign in');
    } finally {
      setIsLoading(false);
    }
  }

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
        <View style={styles.notice}>
          <Feather name="alert-triangle" size={18} color={c.primary} />
          <View style={styles.noticeCopy}>
            <Text style={{ color: c.primary, fontSize: 15, fontFamily: 'Inter_600SemiBold' }}>
              Development demo login
            </Text>
            <Text style={{ color: c.mutedForeground, fontSize: 13, lineHeight: 19, marginTop: 4 }}>
              Development-only demo access. It uses a short-lived local session and never creates a real account.
            </Text>
          </View>
        </View>

        <View style={{ alignItems: 'center', marginBottom: 24 }}>
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
            <Feather name="key" size={28} color={c.primaryForeground} />
          </View>
          <Text style={{ color: c.foreground, fontSize: 26, fontFamily: 'Inter_700Bold' }}>
            {isSignIn ? 'Welcome back' : 'Try the demo'}
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
            {isSignIn ? 'Use the shared development credentials.' : 'No sign-up or email verification is needed.'}
          </Text>
        </View>

        <View style={[styles.credentials, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={{ color: c.foreground, fontFamily: 'Inter_600SemiBold', marginBottom: 6 }}>
            Demo credentials
          </Text>
          <Text style={{ color: c.mutedForeground, fontSize: 13 }}>
            Email: <Text style={{ color: c.foreground }}>{DEV_DEMO_EMAIL}</Text>
          </Text>
          <Text style={{ color: c.mutedForeground, fontSize: 13, marginTop: 4 }}>
            Password: <Text style={{ color: c.foreground }}>{DEV_DEMO_PASSWORD}</Text>
          </Text>
        </View>

        <TextInput
          testID="email-input"
          style={[styles.input, { backgroundColor: c.card, borderColor: c.border, color: c.foreground }]}
          autoCapitalize="none"
          value={email}
          placeholder="Email address"
          placeholderTextColor={c.mutedForeground}
          onChangeText={setEmail}
          keyboardType="email-address"
        />
        <TextInput
          testID="password-input"
          style={[styles.input, { backgroundColor: c.card, borderColor: c.border, color: c.foreground }]}
          value={password}
          placeholder="Password"
          placeholderTextColor={c.mutedForeground}
          secureTextEntry
          onChangeText={setPassword}
        />
        {error ? (
          <Text testID="auth-error" accessibilityRole="alert" style={{ color: c.destructive, fontSize: 13, marginBottom: 8 }}>
            {error}
          </Text>
        ) : null}

        <Pressable
          testID={isSignIn ? 'sign-in-button' : 'sign-up-button'}
          onPress={handleSubmit}
          disabled={!email || !password || isLoading}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: c.primary,
              opacity: !email || !password ? 0.5 : pressed ? 0.8 : 1,
            },
          ]}
        >
          <Text style={{ color: c.primaryForeground, fontSize: 16, fontFamily: 'Inter_600SemiBold' }}>
            {isLoading ? 'Signing in…' : isSignIn ? 'Enter demo' : 'Start demo'}
          </Text>
        </Pressable>

        <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 24 }}>
          <Text style={{ color: c.mutedForeground, fontFamily: 'Inter_400Regular' }}>
            {isSignIn ? 'Need the demo entry point? ' : 'Already have the demo credentials? '}
          </Text>
          <Link href={alternateHref as any}>
            <Text style={{ color: c.primary, fontFamily: 'Inter_600SemiBold' }}>
              {isSignIn ? 'Use sign up' : 'Use sign in'}
            </Text>
          </Link>
        </View>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: 'rgba(245, 190, 50, 0.35)',
    borderRadius: colors.radius,
    padding: 14,
    marginBottom: 24,
  },
  noticeCopy: { flex: 1, marginLeft: 10 },
  credentials: {
    borderWidth: 1,
    borderRadius: colors.radius,
    padding: 14,
    marginBottom: 16,
  },
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