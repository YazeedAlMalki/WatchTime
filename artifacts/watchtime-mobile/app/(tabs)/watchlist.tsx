import React from 'react';
import {
  FlatList,
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  showSignInUnavailableMessage,
  useAppAuth,
} from '@/lib/app-auth';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getMyWatchlist,
  useRemoveFromWatchlist,
  getGetMyWatchlistQueryKey,
} from '@workspace/api-client-react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { EmptyState, ErrorState, Loading, PosterCard } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import colors from '@/constants/colors';

const PAGE_SIZE = 24;

export default function WatchlistScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isSignedIn, isAuthAvailable, userId } = useAppAuth();
  const queryClient = useQueryClient();
  const watchlist = useInfiniteQuery({
    queryKey: [...getGetMyWatchlistQueryKey(), 'account', userId, 'infinite'],
    initialPageParam: undefined as string | undefined,
    enabled: !!isSignedIn && !!userId,
    queryFn: ({ pageParam, signal }) =>
      getMyWatchlist({ limit: PAGE_SIZE, before: pageParam }, { signal }),
    getNextPageParam: (lastPage) =>
      lastPage.length === PAGE_SIZE ? lastPage.at(-1)?.collectionCursor : undefined,
  });
  const remove = useRemoveFromWatchlist({
    mutation: {
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: getGetMyWatchlistQueryKey() }),
    },
  });

  if (isSignedIn && !userId) return <Loading />;

  if (!isSignedIn) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background, justifyContent: 'center' }}>
        <EmptyState
          icon="bookmark"
          title="Sign in to use your watchlist"
          subtitle="Your watchlist syncs with your WatchTime account on the web."
        />
        <Pressable
          testID="watchlist-sign-in"
          onPress={() => {
            if (isAuthAvailable === false) {
              showSignInUnavailableMessage();
              return;
            }
            router.push('/(auth)/sign-in');
          }}
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

  if (watchlist.isLoading) return <Loading />;
  if (watchlist.isError) return <ErrorState onRetry={() => watchlist.refetch()} />;

  const data = watchlist.data?.pages.flat() ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      {data.length === 0 ? (
        <EmptyState
          icon="bookmark"
          title="Watchlist is empty"
          subtitle="Browse titles and tap the bookmark to save them for later."
        />
      ) : (
        <FlatList
          data={data}
          scrollEnabled={data.length > 0}
          keyExtractor={(t) => String(t.id)}
          numColumns={3}
          columnWrapperStyle={{ gap: 12, paddingHorizontal: 16 }}
          contentContainerStyle={{
            gap: 16,
            paddingTop: 16,
            paddingBottom: (Platform.OS === 'web' ? 34 : insets.bottom) + 90,
          }}
          refreshControl={
            <RefreshControl
              refreshing={watchlist.isRefetching}
              onRefresh={() => watchlist.refetch()}
              tintColor={c.primary}
            />
          }
          onEndReached={() => {
            if (watchlist.hasNextPage && !watchlist.isFetchingNextPage) {
              watchlist.fetchNextPage();
            }
          }}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            watchlist.isFetchingNextPage ? <ActivityIndicator color={c.primary} /> : null
          }
          renderItem={({ item }) => (
            <View style={{ width: 104 }}>
              <PosterCard title={item} width={104} />
              <Pressable
                testID={`remove-watchlist-${item.id}`}
                disabled={remove.isPending}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  remove.mutate({ id: item.id });
                }}
                style={({ pressed }) => [
                  {
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    marginTop: 6,
                    paddingVertical: 6,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: c.border,
                    backgroundColor: c.card,
                    opacity: remove.isPending ? 0.5 : pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Feather name="x" size={13} color={c.mutedForeground} />
                <Text style={{ color: c.mutedForeground, fontSize: 12, fontFamily: 'Inter_500Medium' }}>
                  Remove
                </Text>
              </Pressable>
            </View>
          )}
        />
      )}
    </View>
  );
}
