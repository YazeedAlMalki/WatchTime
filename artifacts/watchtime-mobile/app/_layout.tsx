import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { View } from 'react-native';
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
import { getDevDemoToken } from '@/lib/dev-demo-session';
import { AppAuthProvider } from '@/lib/app-auth';
import { markStartup } from '@/lib/startup-metrics';
import { ExpoPreviewReadiness } from '@/components/ExpoPreviewReadiness';

// Prevent the splash screen from auto-hiding before asset loading is complete.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

const domain = process.env.EXPO_PUBLIC_DOMAIN;
if (domain) setBaseUrl(`https://${domain}`);

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!;
const proxyUrl = process.env.EXPO_PUBLIC_CLERK_PROXY_URL || undefined;

const queryClient = new QueryClient();

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

function RootLayoutNav() {
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
      <Stack.Screen name="(auth)/sign-in" options={{ presentation: 'modal' }} />
      <Stack.Screen name="(auth)/sign-up" options={{ presentation: 'modal' }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      markStartup(fontError ? 'font-error' : 'fonts-ready');
      void SplashScreen.hideAsync().catch((error: unknown) => {
        markStartup('splash-recovery-error', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
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
              <GestureHandlerRootView style={{ flex: 1 }}>
                <KeyboardProvider>
                  <StatusBar style="light" />
                  <View style={{ flex: 1 }}>
                    <ExpoPreviewReadiness />
                    <RootLayoutNav />
                  </View>
                </KeyboardProvider>
              </GestureHandlerRootView>
            </QueryClientProvider>
          </ErrorBoundary>
        </SafeAreaProvider>
      </AppAuthProvider>
    </ClerkProvider>
  );
}
