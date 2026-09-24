import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import colors from '@/constants/colors';

export function ExpoPreviewReadiness() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  if (!__DEV__) return null;

  const cliSessionState =
    process.env.EXPO_PUBLIC_REPLIT_EXPO_CLI_SESSION_STATE;
  const expoGoReady = Platform.OS !== 'web';
  const cliReady = cliSessionState === 'ready';
  const cliStateLabel =
    cliSessionState === 'ready'
      ? 'Ready — Replit managed sign-in succeeded'
      : cliSessionState === 'blocked'
        ? 'Not ready — Replit managed sign-in failed'
        : 'Unavailable — no managed session was reported';

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop:
            Platform.OS === 'web' ? 8 : Math.max(insets.top, 8),
          backgroundColor: c.background,
        },
      ]}
    >
      <View
        testID="expo-preview-readiness"
        accessibilityRole="summary"
        style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
      >
        <Text style={[styles.title, { color: c.foreground }]}>Phone preview checks</Text>
        <Text style={[styles.status, { color: c.foreground }]}>
          Expo Go:{' '}
          {expoGoReady
            ? 'Ready — WatchTime is open in Expo Go on this phone'
            : 'Not confirmed — web preview does not verify phone sign-in'}
        </Text>
        <Text
          testID="expo-cli-session-status"
          style={[styles.status, { color: c.foreground }]}
        >
          Expo CLI: {cliStateLabel}
        </Text>
        {!cliReady ? (
          <Text style={[styles.help, { color: c.mutedForeground }]}>
            This is a Replit sign-in blocker, not a WatchTime app failure. Refresh
            the Replit workspace, restart the mobile preview, and follow any
            managed sign-in steps shown in Preview on your phone. If those steps
            are missing, the managed session is unavailable. Never enter your
            Replit password in Expo Go.
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: 8,
  },
  card: {
    marginHorizontal: 16,
    padding: 12,
    borderWidth: 1,
    borderRadius: colors.radius,
  },
  title: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 5,
  },
  status: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    lineHeight: 18,
  },
  help: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    lineHeight: 17,
    marginTop: 6,
  },
});