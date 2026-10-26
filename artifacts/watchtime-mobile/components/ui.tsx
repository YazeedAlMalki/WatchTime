import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import colors from '@/constants/colors';
import type { Title } from '@workspace/api-client-react';
import { EvidenceText } from './layout-evidence';

export function SectionHeader({ title }: { title: string }) {
  const c = useColors();
  return (
    <Text
      style={{
        color: c.foreground,
        fontSize: 20,
        fontFamily: 'Inter_700Bold',
        marginHorizontal: 16,
        marginTop: 24,
        marginBottom: 12,
      }}
    >
      {title}
    </Text>
  );
}

export function PosterCard({
  title,
  width = 120,
}: {
  title: Title;
  width?: number;
}) {
  const c = useColors();
  const router = useRouter();
  const height = width * 1.5;
  return (
    <Pressable
      testID={`poster-${title.id}`}
      onPress={() => router.push(`/title/${title.id}`)}
      style={({ pressed }) => [{ width, opacity: pressed ? 0.7 : 1 }]}
    >
      {title.posterUrl ? (
        <Image
          source={{ uri: title.posterUrl }}
          style={{
            width,
            height,
            borderRadius: colors.radius,
            backgroundColor: c.muted,
          }}
          contentFit="cover"
          transition={150}
        />
      ) : (
        <View
          style={{
            width,
            height,
            borderRadius: colors.radius,
            backgroundColor: c.muted,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Feather name="film" size={28} color={c.mutedForeground} />
        </View>
      )}
      <Text
        numberOfLines={2}
        style={{
          color: c.foreground,
          fontSize: 13,
          fontFamily: 'Inter_500Medium',
          marginTop: 6,
        }}
      >
        {title.name}
      </Text>
      <Text
        style={{
          color: c.mutedForeground,
          fontSize: 12,
          fontFamily: 'Inter_400Regular',
        }}
      >
        {title.year ?? ''}
      </Text>
    </Pressable>
  );
}

export function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  subtitle?: string;
}) {
  const c = useColors();
  return (
    <View style={styles.empty}>
      <Feather name={icon} size={36} color={c.mutedForeground} />
      <Text
        style={{
          color: c.foreground,
          fontSize: 16,
          fontFamily: 'Inter_600SemiBold',
          marginTop: 12,
        }}
      >
        {title}
      </Text>
      {subtitle ? (
        <Text
          style={{
            color: c.mutedForeground,
            fontSize: 14,
            fontFamily: 'Inter_400Regular',
            marginTop: 4,
            textAlign: 'center',
          }}
        >
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

export function Loading() {
  const c = useColors();
  return (
    <View style={styles.center}>
      <ActivityIndicator color={c.primary} />
    </View>
  );
}

export function ErrorState({
  onRetry,
  message = "Couldn't load data",
  retryAccessibilityLabel = 'Retry',
}: {
  onRetry: () => void;
  message?: string;
  retryAccessibilityLabel?: string;
}) {
  const c = useColors();
  return (
    <View style={styles.empty}>
      <Feather name="alert-circle" size={32} color={c.destructive} />
      <Text
        style={{
          color: c.foreground,
          fontSize: 15,
          fontFamily: 'Inter_500Medium',
          marginTop: 10,
        }}
      >
        {message}
      </Text>
      <Pressable
        testID="retry-button"
        accessibilityRole="button"
        accessibilityLabel={retryAccessibilityLabel}
        onPress={onRetry}
        style={({ pressed }) => [
          {
            marginTop: 12,
            paddingHorizontal: 20,
            paddingVertical: 10,
            borderRadius: colors.radius,
            backgroundColor: c.primary,
            opacity: pressed ? 0.8 : 1,
          },
        ]}
      >
        <Text
          style={{
            color: c.primaryForeground,
            fontFamily: 'Inter_600SemiBold',
          }}
        >
          Retry
        </Text>
      </Pressable>
    </View>
  );
}

export function Chip({
  label,
  active,
  onPress,
  evidenceId,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  evidenceId?: string;
}) {
  const c = useColors();
  return (
    <Pressable
      testID={`chip-${label}`}
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
      style={({ pressed }) => [
        {
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderRadius: 999,
          backgroundColor: active ? c.primary : c.secondary,
          borderWidth: 1,
          borderColor: active ? c.primary : c.border,
          opacity: pressed ? 0.8 : 1,
          marginRight: 8,
        },
      ]}
    >
      <EvidenceText
        evidenceId={evidenceId ?? `chip-${label}`}
        style={{
          color: active ? c.primaryForeground : c.secondaryForeground,
          fontSize: 13,
          fontFamily: 'Inter_500Medium',
        }}
      >
        {label}
      </EvidenceText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 32,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
});
