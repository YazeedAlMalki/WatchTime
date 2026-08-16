import React, { useEffect, useState } from 'react';
import {
  FlatList,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useListTitles,
  type ListTitlesParams,
} from '@workspace/api-client-react';
import { Chip, EmptyState, ErrorState, Loading, PosterCard } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import colors from '@/constants/colors';

const TYPES: { label: string; value: ListTitlesParams['type'] | undefined }[] = [
  { label: 'All', value: undefined },
  { label: 'TV Shows', value: 'tv' },
  { label: 'Movies', value: 'movie' },
  { label: 'Anime', value: 'anime' },
  { label: 'Documentaries', value: 'documentary' },
];

const SORTS: { label: string; value: NonNullable<ListTitlesParams['sort']> }[] = [
  { label: 'Popular', value: 'popular' },
  { label: 'Newest', value: 'newest' },
  { label: 'A–Z', value: 'name' },
];

export default function BrowseScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [type, setType] = useState<ListTitlesParams['type'] | undefined>(undefined);
  const [sort, setSort] = useState<NonNullable<ListTitlesParams['sort']>>('popular');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 400);
    return () => clearTimeout(t);
  }, [query]);

  const titles = useListTitles({
    ...(debounced ? { q: debounced } : {}),
    ...(type ? { type } : {}),
    sort,
    limit: 40,
  });

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
        <View
          style={[
            styles.searchBox,
            { backgroundColor: c.card, borderColor: c.border },
          ]}
        >
          <Feather name="search" size={18} color={c.mutedForeground} />
          <TextInput
            testID="search-input"
            style={{
              flex: 1,
              color: c.foreground,
              fontSize: 15,
              fontFamily: 'Inter_400Regular',
              paddingVertical: 12,
            }}
            value={query}
            onChangeText={setQuery}
            placeholder="Search titles, including alternate names…"
            placeholderTextColor={c.mutedForeground}
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 ? (
            <Feather
              name="x"
              size={18}
              color={c.mutedForeground}
              onPress={() => setQuery('')}
            />
          ) : null}
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginTop: 12 }}
        >
          {TYPES.map((t) => (
            <Chip
              key={t.label}
              label={t.label}
              active={type === t.value}
              onPress={() => setType(t.value)}
            />
          ))}
          <View style={{ width: 8 }} />
          {SORTS.map((s) => (
            <Chip
              key={s.value}
              label={s.label}
              active={sort === s.value}
              onPress={() => setSort(s.value)}
            />
          ))}
        </ScrollView>
      </View>

      {titles.isLoading ? (
        <Loading />
      ) : titles.isError ? (
        <ErrorState onRetry={() => titles.refetch()} />
      ) : (titles.data ?? []).length === 0 ? (
        <EmptyState
          icon="search"
          title="No results"
          subtitle={debounced ? `Nothing matched "${debounced}" — we also search alternate titles.` : 'Try a different filter.'}
        />
      ) : (
        <FlatList
          data={titles.data ?? []}
          scrollEnabled={(titles.data ?? []).length > 0}
          keyExtractor={(t) => String(t.id)}
          numColumns={3}
          columnWrapperStyle={{ gap: 12, paddingHorizontal: 16 }}
          contentContainerStyle={{
            gap: 16,
            paddingTop: 16,
            paddingBottom: (Platform.OS === 'web' ? 34 : insets.bottom) + 90,
          }}
          renderItem={({ item }) => <PosterCard title={item} width={104} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: colors.radius,
    paddingHorizontal: 14,
  },
});
