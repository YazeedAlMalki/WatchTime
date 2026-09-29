import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ClerkProvider, useAuth } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { setBaseUrl, setAuthTokenGetter } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import colors from '@/constants/colors';
import {
  consumeDevSplashFailure,
  type DevSplashFailure,
} from '@/lib/dev-splash-failure';
import { getDevDemoToken } from '@/lib/dev-demo-session';
import {
  AppAuthProvider,
  AppAuthUnavailableProvider,
} from '@/lib/app-auth';
import { ExpoPreviewReadiness } from '@/components/ExpoPreviewReadiness';
import { markStartup, reportStartupFailure } from '@/lib/startup-metrics';

const domain = process.env.EXPO_PUBLIC_DOMAIN;
if (domain) setBaseUrl(`https://${domain}`);

const SPLASH_HIDE_TIMEOUT_MS = 5_000;

// Defer storage access one microtask so preventAutoHideAsync starts first.
const devSplashFailure = Promise.resolve().then(consumeDevSplashFailure);

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function reportSplashSetupFailure(error: unknown) {
  markStartup('splash-setup-error', { error: describeError(error) });
  reportStartupFailure('splash-prevent-error');
}

function recoverSplashScreen() {
  try {
    void devSplashFailure
      .then((failure: DevSplashFailure) => {
        if (failure === 'cleanup') {
          throw new Error('Development-only forced splash cleanup failure');
        }
        hideSplashWithTimeout();
      })
      .catch(reportSplashHideFailure);
  } catch (error) {
    reportSplashHideFailure(error);
  }
}

function reportSplashHideFailure(error: unknown) {
  markStartup('splash-recovery-error', {
    error: describeError(error),
  });
  reportStartupFailure('splash-hide-error');
}

function hideSplashWithTimeout() {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    const hidePromise = SplashScreen.hideAsync();
    timeout = setTimeout(() => {
      timeout = undefined;
      markStartup('splash-hide-timeout', {
        timeoutMs: SPLASH_HIDE_TIMEOUT_MS,
      });
      reportStartupFailure('splash-hide-timeout');

      try {
        // hide() is synchronous, so a stuck hideAsync promise cannot block this
        // second attempt to uncover the app.
        SplashScreen.hide();
      } catch (error) {
        reportSplashHideFailure(error);
      }
    }, SPLASH_HIDE_TIMEOUT_MS);

    void Promise.resolve(hidePromise).then(
      () => {
        if (timeout !== undefined) {
          clearTimeout(timeout);
          timeout = undefined;
        }
      },
      (error: unknown) => {
        if (timeout !== undefined) {
          clearTimeout(timeout);
          timeout = undefined;
        }
        reportSplashHideFailure(error);
      },
    );
  } catch (error) {
    if (timeout !== undefined) clearTimeout(timeout);
    reportSplashHideFailure(error);
  }
}

// Start this immediately so reading the one-shot development switch never lets
// the native splash auto-hide before fonts are ready.
try {
  const preventAutoHide = SplashScreen.preventAutoHideAsync();
  void Promise.all([preventAutoHide, devSplashFailure])
    .then(([, failure]) => {
      if (failure === 'setup') {
        throw new Error('Development-only forced splash setup failure');
      }
    })
    .catch(reportSplashSetupFailure);
} catch (error) {
  reportSplashSetupFailure(error);
}

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!;
const proxyUrl = process.env.EXPO_PUBLIC_CLERK_PROXY_URL || undefined;

const queryClient = new QueryClient();

const authUnavailableQueryClient = new QueryClient();
/** Attaches the Clerk bearer token to every generated API client request. */
function AuthTokenBridge() {
  const { getToken, isLoaded } = useAuth();
  useEffect(() => {
    // Check the development session first. This prevents Clerk's (possibly
    // still-refreshing) token from winning a request immediately after demo
    // navigation.
    setAuthTokenGetter(async () => {
      const demoToken = typeof __DEV__ !== 'undefined' && __DEV__ ? await getDevDemoToken() : null;
      if (demoToken) return demoToken;
      return getToken();
    });
    return () => setAuthTokenGetter(null);
  }, [getToken]);

  useEffect(() => {
    if (isLoaded) {
      markStartup('auth-ready');
    }
  }, [isLoaded]);

  return null;
}

function StartupFrameMarker() {
  useEffect(() => {
    const frame = requestAnimationFrame(() => markStartup('first-frame'));
    return () => cancelAnimationFrame(frame);
  }, []);

  return null;
}

function RootLayoutNav({ authAvailable = true }: { authAvailable?: boolean }) {
  return (
    <Stack
      screenOptions={{
        headerBackTitle: 'Back',
        headerShown: false,
        contentStyle: { backgroundColor: colors.dark.background },
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="title/[id]" />
      {authAvailable ? (
        <Stack.Screen name="(auth)/sign-in" options={{ presentation: 'modal' }} />
      ) : null}
      {authAvailable ? (
        <Stack.Screen name="(auth)/sign-up" options={{ presentation: 'modal' }} />
      ) : null}
    </Stack>
  );
}

function AuthProviderFailureFallback({
  resetError,
}: {
  resetError: () => void;
}) {
  return (
    <AppAuthUnavailableProvider>
      <SafeAreaProvider>
        <ErrorBoundary>
          <QueryClientProvider client={authUnavailableQueryClient}>
            <RootNavigationFrame
              authAvailable={false}
              onRetry={resetError}
            />
          </QueryClientProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </AppAuthUnavailableProvider>
  );
}

function AuthProviderFailureNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <View
      testID="auth-provider-failure"
      style={[
        styles.authProviderFailure,
        { backgroundColor: colors.dark.background },
      ]}
    >
      <Text
        accessibilityRole="header"
        style={[styles.authProviderFailureTitle, { color: colors.dark.foreground }]}
      >
        Sign-in unavailable
      </Text>
      <Text
        style={[
          styles.authProviderFailureMessage,
          { color: colors.dark.mutedForeground },
        ]}
      >
        WatchTime couldn&apos;t start its sign-in service. You can still browse
        public shows. Check your connection and retry sign-in setup.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Retry sign-in setup"
        testID="retry-auth-provider"
        onPress={onRetry}
        style={({ pressed }) => [
          styles.authProviderRetry,
          {
            backgroundColor: colors.dark.primary,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <Text
          style={[
            styles.authProviderRetryText,
            { color: colors.dark.primaryForeground },
          ]}
        >
          Retry
        </Text>
      </Pressable>
    </View>
  );
}

function RootApplication() {
  return (
    <ErrorBoundary
      FallbackComponent={AuthProviderFailureFallback}
      onError={(error) => {
        markStartup('auth-provider-error', { error: describeError(error) });
        reportStartupFailure('auth-provider-error');
      }}
    >
      <ClerkProvider
        publishableKey={publishableKey}
        tokenCache={tokenCache}
        proxyUrl={proxyUrl}
      >
        <AppAuthProvider>
          <SafeAreaProvider>
            <ErrorBoundary>
              <QueryClientProvider client={queryClient}>
                <AuthTokenBridge />
                <StartupFrameMarker />
                <RootNavigationFrame authAvailable />
              </QueryClientProvider>
            </ErrorBoundary>
          </SafeAreaProvider>
        </AppAuthProvider>
      </ClerkProvider>
    </ErrorBoundary>
  );
}
function FontLoaderFailureFallback({ error }: { error: Error }) {
  useEffect(() => {
    recoverSplashScreen();
  }, []);

  return <RootApplication />;
}

function FontGatedRootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      markStartup(fontError ? 'font-error' : 'fonts-ready');
      if (fontError) reportStartupFailure('font-error');
      recoverSplashScreen();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return <RootApplication />;
}

export default function RootLayout() {
  return (
    <ErrorBoundary
      FallbackComponent={FontLoaderFailureFallback}
      onError={(error) => {
        markStartup('font-error', {
          error: describeError(error),
          source: 'font-loader-throw',
        });
        reportStartupFailure('font-error');
      }}
    >
      <FontGatedRootLayout />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  authProviderFailure: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.dark.mutedForeground,
  },
  authProviderFailureTitle: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  authProviderFailureMessage: {
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
  },
  authProviderRetry: {
    minWidth: 110,
    minHeight: 42,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: colors.radius,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  authProviderRetryText: {
    fontSize: 16,
    fontWeight: '600',
  },
});

function RootNavigationFrame({
  authAvailable,
  onRetry,
}: {
  authAvailable: boolean;
  onRetry?: () => void;
}) {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <StatusBar style="light" />
        <View style={{ flex: 1 }}>
          {!authAvailable && onRetry ? (
            <AuthProviderFailureNotice onRetry={onRetry} />
          ) : null}
          <View style={{ flex: 1 }}>
            <ExpoPreviewReadiness />
            <RootLayoutNav authAvailable={authAvailable} />
          </View>
        </View>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
