import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react-native';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn() };
const mockRoute = { current: { id: '456' } };
const mockAuth = { isSignedIn: false };
const mockTitle = {
  id: 456,
  name: 'The selected movie',
  type: 'movie',
  year: 2024,
  genres: [],
  altTitles: [],
  providers: [],
  seasons: [],
  inWatchlist: false,
  watched: false,
};
const mockAdd = jest.fn();
const mockRemove = jest.fn();
const mockMark = jest.fn();
const mockUnmark = jest.fn();
const mockTitleFetch = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockRoute.current,
  Link: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/lib/app-auth', () => ({
  useAppAuth: () => mockAuth,
}));
jest.mock('expo-image', () => ({
  Image: () => null,
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));
jest.mock('@workspace/api-client-react', () => ({
  useGetTitle: (id: number) => {
    mockTitleFetch(id);
    return { data: { ...mockTitle }, isLoading: false, isError: false };
  },
  useGetSimilarTitles: () => ({ data: [] }),
  useGetTitleSafety: () => ({ data: null, isLoading: false }),
  useAddToWatchlist: () => ({ mutate: mockAdd, isPending: false }),
  useRemoveFromWatchlist: () => ({ mutate: mockRemove, isPending: false }),
  useMarkTitleWatched: () => ({ mutate: mockMark, isPending: false }),
  useUnmarkTitleWatched: () => ({ mutate: mockUnmark, isPending: false }),
}));
jest.mock('@/components/ui', () => ({
  SectionHeader: () => null,
  ErrorState: () => null,
  Loading: () => null,
  PosterCard: () => null,
}));
jest.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#fff', foreground: '#000', mutedForeground: '#777',
    primary: '#6633cc', primaryForeground: '#fff', card: '#eee',
    border: '#ccc', secondary: '#eee', muted: '#ddd', destructive: '#c00',
  }),
}));
jest.mock('@/constants/colors', () => ({ __esModule: true, default: { radius: 8 } }));

import TitleDetailScreen from '../app/title/[id]';

describe('title action sign-in return', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.isSignedIn = false;
    mockRoute.current = { id: '456' };
    mockTitle.inWatchlist = false;
    mockTitle.watched = false;
    mockRouter.canGoBack.mockReturnValue(false);
  });

  afterEach(cleanup);

  it.each([
    ['watchlist-toggle', 'Watchlist'],
    ['watched-toggle', 'Mark watched'],
  ])('sends signed-out %s to sign-in for this movie without changing its state', async (action, initialLabel) => {
    const detail = await render(<TitleDetailScreen />);
    expect(detail.getByText('The selected movie')).toBeTruthy();
    expect(detail.getByText(initialLabel)).toBeTruthy();
    fireEvent.press(detail.getByTestId(action));

    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/(auth)/sign-in',
      params: { returnTo: '/title/456' },
    });
    expect(mockAdd).not.toHaveBeenCalled();
    expect(mockMark).not.toHaveBeenCalled();
  });

  it.each([
    ['watchlist-toggle', 'Watchlist', mockAdd],
    ['watched-toggle', 'Mark watched', mockMark],
  ])('shows the unchanged %s state after returning authenticated, until the user taps it', async (action, initialLabel, mutation) => {
    mockAuth.isSignedIn = true;
    const returned = await render(<TitleDetailScreen />);
    expect(mockTitleFetch).toHaveBeenLastCalledWith(456);
    expect(returned.getByText('The selected movie')).toBeTruthy();
    expect(returned.getByText(initialLabel)).toBeTruthy();
    expect(mockAdd).not.toHaveBeenCalled();
    expect(mockMark).not.toHaveBeenCalled();

    fireEvent.press(returned.getByTestId(action));
    expect(mutation).toHaveBeenCalledWith({ id: 456 });
  });
});