import React, { useCallback, useEffect, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { useAuth, useSignIn, useSSO } from '@clerk/expo';
import { Link, Redirect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useColors } from '@/hooks/useColors';
import colors from '@/constants/colors';

const useWarmUpBrowser = () => {
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);
};

WebBrowser.maybeCompleteAuthSession();

export default function SignInScreen() {
  useWarmUpBrowser();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isSignedIn } = useAuth();
  const { signIn, errors, fetchStatus } = useSignIn();
  const { startSSOFlow } = useSSO();

  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const [emailAddress, setEmailAddress] = useState('');
  const [password, setPassword] = useState('');

  const navigateAfterSignIn = useCallback(
    ({ session, decorateUrl }: any) => {
      if (session?.currentTask) return;
      const dest = (returnTo as string | undefined) ?? '/';
      const url = decorateUrl(dest);
      if (typeof url === 'string' && url.startsWith('http')) {
        if (Platform.OS === 'web') window.location.href = url;
        else router.replace(dest as Href);
      } else {
        router.replace(url as Href);
      }
    },
    [router, returnTo],
  );

  const handleSubmit = async () => {
    const { error } = await signIn.password({ emailAddress, password });
    if (error) return;
    if (signIn.status === 'complete') {
      await signIn.finalize({ navigate: navigateAfterSignIn });
    }
  };

  const handleGoogle = useCallback(async () => {
    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy: 'oauth_google',
        redirectUrl: AuthSession.makeRedirectUri(),
      });
      if (createdSessionId && setActive) {
        await setActive({
          session: createdSessionId,
          navigate: async ({ session }: any) => {
            if (session?.currentTask) return;
            const dest = (returnTo as string | undefined) ?? '/';
            router.replace(dest as Href);
          },
        });
      }
    } catch (err) {
      console.error(JSON.stringify(err, null, 2));
    }
  }, [startSSOFlow, router, returnTo]);

  if (isSignedIn) return <Redirect href="/" />;

  const busy = fetchStatus === 'fetching';
  const topError =
    errors?.fields?.identifier?.message ||
    errors?.fields?.password?.message ||
    (Array.isArray(errors?.raw) && errors.raw.length
      ? String((errors.raw[0] as any)?.message ?? '')
      : '');

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
            <Feather name="play" size={30} color={c.primaryForeground} />
          </View>
          <Text
            style={{
              color: c.foreground,
              fontSize: 26,
              fontFamily: 'Inter_700Bold',
            }}
          >
            Welcome back
          </Text>
          <Text
            style={{
              color: c.mutedForeground,
              fontSize: 15,
              fontFamily: 'Inter_400Regular',
              marginTop: 6,
            }}
          >
            Sign in to keep tracking your shows
          </Text>
        </View>

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
        <TextInput
          testID="password-input"
          style={[styles.input, { backgroundColor: c.card, borderColor: c.border, color: c.foreground }]}
          value={password}
          placeholder="Password"
          placeholderTextColor={c.mutedForeground}
          secureTextEntry
          onChangeText={setPassword}
        />
        {topError ? (
          <Text style={{ color: c.destructive, fontSize: 13, marginBottom: 8 }}>
            {topError}
          </Text>
        ) : null}

        <Pressable
          testID="sign-in-button"
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
            {busy ? 'Signing in…' : 'Sign in'}
          </Text>
        </Pressable>

        <View style={styles.dividerRow}>
          <View style={[styles.divider, { backgroundColor: c.border }]} />
          <Text style={{ color: c.mutedForeground, fontSize: 13, marginHorizontal: 12 }}>or</Text>
          <View style={[styles.divider, { backgroundColor: c.border }]} />
        </View>

        <Pressable
          testID="google-sign-in-button"
          onPress={handleGoogle}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: c.card,
              borderWidth: 1,
              borderColor: c.border,
              flexDirection: 'row',
              gap: 10,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <Feather name="globe" size={18} color={c.foreground} />
          <Text style={{ color: c.foreground, fontSize: 15, fontFamily: 'Inter_500Medium' }}>
            Continue with Google
          </Text>
        </Pressable>

        <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 24 }}>
          <Text style={{ color: c.mutedForeground, fontFamily: 'Inter_400Regular' }}>
            New to WatchTime?{' '}
          </Text>
          <Link href="/(auth)/sign-up">
            <Text style={{ color: c.primary, fontFamily: 'Inter_600SemiBold' }}>Sign up</Text>
          </Link>
        </View>
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
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  divider: { flex: 1, height: 1 },
});
