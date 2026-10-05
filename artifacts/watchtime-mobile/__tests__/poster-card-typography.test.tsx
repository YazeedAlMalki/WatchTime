import React from 'react';
import { render } from '@testing-library/react-native';

jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
}));
jest.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    foreground: '#111',
    muted: '#eee',
    mutedForeground: '#777',
  }),
}));

import { PosterCard } from '../components/ui';

describe('poster card typography', () => {
  it('allows long title names to wrap onto a second line', async () => {
    const title = {
      id: 42,
      name: 'A long title that needs more than one line',
      year: 2026,
      posterUrl: null,
    };
    const screen = await render(<PosterCard title={title as any} />);

    expect(screen.getByText(title.name).props.numberOfLines).toBe(2);
  });
});
