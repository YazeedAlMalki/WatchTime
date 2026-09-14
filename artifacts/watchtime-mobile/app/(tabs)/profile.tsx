import React from 'react';
import {
  Platform,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth, useUser } from '@clerk/expo';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getGetMeQueryKey, useGetMe, useUpdateMe } from '@workspace/api-client-react';
import { EmptyState, ErrorState, Loading } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import colors from '@/constants/colors';

const RATING_REGIONS = [
  { value: 'US', label: 'United States', system: 'MPAA' },
  { value: 'GB', label: 'United Kingdom', system: 'BBFC' },
  { value: 'DE', label: 'Germany', system: 'FSK' },
  { value: 'FR', label: 'France', system: 'CNC' },
  { value: 'AU', label: 'Australia', system: 'Australian Classification' },
  { value: 'BR', label: 'Brazil', system: 'ClassInd' },
] as const;

function Stat({ label, value }: { label: string; value: string | number }) {
  const c = useColors();
  return (
    <View style={[styles.stat, { backgroundColor: c.card, borderColor: c.border }]}>
      <Text style={{ color: c.foreground, fontSize: 20, fontFamily: 'Inter_700Bold' }}>
        {value}
      </Text>
      <Text style={{ color: c.mutedForeground, fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
        {label}
      </Text>
    </View>
  );
}

export default function ProfileScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isSignedIn, signOut } = useAuth();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const me = useGetMe({ query: { enabled: !!isSignedIn } as any });
  const updateMe = useUpdateMe({
    mutation: {
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() }),
          queryClient.invalidateQueries({
            predicate: (query) => String(query.queryKey[0]).startsWith('/api/safety'),
          }),
        ]);
      },
      onError: () => Alert.alert('Could not save rating region', 'Please try again.'),
    },
  });

  if (!isSignedIn) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background, justifyContent: 'center' }}>
        <EmptyState
          icon="user"
          title="You're not signed in"
          subtitle="Sign in with your WatchTime account — the same one you use on the web."
        />
        <Pressable
          testID="profile-sign-in"
          onPress={() => router.push('/(auth)/sign-in')}
          style={({ pressed }) => [
            {
              marginHorizontal: 32,
              backgroundColor: c.primary,
              borderRadius: colors.radius,
              paddingVertical: 14,
              alignItems: 'center',
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <Text style={{ color: c.primaryForeground, fontSize: 15, fontFamily: 'Inter_600SemiBold' }}>
            Sign in
          </Text>
        </Pressable>
      </View>
    );
  }

  if (me.isLoading) return <Loading />;
  if (me.isError) return <ErrorState onRetry={() => me.refetch()} />;

  const profile = me.data;
  const hours = profile?.timeWatchedMinutes
    ? Math.round(profile.timeWatchedMinutes / 60)
    : 0;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{
        padding: 16,
        paddingBottom: (Platform.OS === 'web' ? 34 : insets.bottom) + 90,
      }}
    >
      <View style={{ alignItems: 'center', marginVertical: 16 }}>
        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: 36,
            backgroundColor: c.primary,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: c.primaryForeground, fontSize: 28, fontFamily: 'Inter_700Bold' }}>
            {(profile?.name ?? profile?.email ?? '?').charAt(0).toUpperCase()}
          </Text>
        </View>
        <Text style={{ color: c.foreground, fontSize: 20, fontFamily: 'Inter_700Bold', marginTop: 12 }}>
          {profile?.name ?? user?.fullName ?? 'WatchTime user'}
        </Text>
        <Text style={{ color: c.mutedForeground, fontSize: 14, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
          {profile?.email}
        </Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          {profile?.isAdmin ? (
            <View style={[styles.badge, { backgroundColor: c.primary }]}>
              <Text style={{ color: c.primaryForeground, fontSize: 11, fontFamily: 'Inter_600SemiBold' }}>
                Admin
              </Text>
            </View>
          ) : null}
          {profile?.canContribute ? (
            <View style={[styles.badge, { backgroundColor: c.accent }]}>
              <Text style={{ color: c.accentForeground, fontSize: 11, fontFamily: 'Inter_600SemiBold' }}>
                Contributor
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Stat label="Shows" value={profile?.showsTracked ?? 0} />
        <Stat label="Episodes" value={profile?.episodesWatched ?? 0} />
        <Stat label="Movies" value={profile?.moviesWatched ?? 0} />
        <Stat label="Hours" value={hours} />
      </View>

      <View style={[styles.preferenceCard, { backgroundColor: c.card, borderColor: c.border }]}>
        <Text style={{ color: c.foreground, fontSize: 18, fontFamily: 'Inter_700Bold' }}>
          Rating region
        </Text>
        <Text style={{ color: c.mutedForeground, fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 4, lineHeight: 19 }}>
          Prioritize the official classification your family recognizes. Other sourced ratings stay available.
        </Text>
        <View style={{ gap: 8, marginTop: 14 }}>
          {RATING_REGIONS.map((region) => {
            const selected = profile?.preferredRatingRegion === region.value;
            return (
              <Pressable
                key={region.value}
                testID={`rating-region-${region.value}`}
                disabled={updateMe.isPending}
                onPress={() => updateMe.mutate({ data: { preferredRatingRegion: region.value } })}
                style={({ pressed }) => [
                  styles.regionOption,
                  {
                    borderColor: selected ? c.primary : c.border,
                    backgroundColor: selected ? c.accent : c.background,
                    opacity: pressed || updateMe.isPending ? 0.7 : 1,
                  },
                ]}
              >
                <Text style={{ color: c.foreground, fontSize: 14, fontFamily: 'Inter_600SemiBold' }}>{region.label}</Text>
                <Text style={{ color: c.mutedForeground, fontSize: 12, fontFamily: 'Inter_400Regular' }}>{region.system}</Text>
                {selected ? <Feather name="check-circle" size={18} color={c.primary} /> : null}
              </Pressable>
            );
          })}
        </View>
      </View>

      <Pressable
        testID="sign-out-button"
        onPress={async () => {
          await signOut();
          queryClient.clear();
        }}
        style={({ pressed }) => [
          {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            marginTop: 28,
            paddingVertical: 14,
            borderRadius: colors.radius,
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.card,
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        <Feather name="log-out" size={16} color={c.destructive} />
        <Text style={{ color: c.destructive, fontSize: 15, fontFamily: 'Inter_600SemiBold' }}>
          Sign out
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  stat: {
    flex: 1,
    borderWidth: 1,
    borderRadius: colors.radius,
    paddingVertical: 14,
    alignItems: 'center',
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  preferenceCard: {
    borderWidth: 1,
    borderRadius: colors.radius,
    padding: 16,
    marginTop: 20,
  },
  regionOption: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: colors.radius,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
