import React from 'react';
import { cleanup, render } from '@testing-library/react-native';

const mockIsLiquidGlassAvailable = jest.fn();
const mockNativeRoutes: string[] = [];
const mockNativeLabels: string[] = [];
const mockClassicTabs: [string, string][] = [];

jest.mock('expo-glass-effect', () => ({
  isLiquidGlassAvailable: () => mockIsLiquidGlassAvailable(),
}));

jest.mock('expo-router/unstable-native-tabs', () => {
  const React = require('react');
  const { Text, View } = require('react-native');

  const NativeTabs: any = ({ children }: any) => (
    <View testID="native-tabs">{children}</View>
  );
  const Trigger: any = ({ children, name }: any) => (
    mockNativeRoutes.push(name),
    <View testID={`native-tab-trigger-${name}`}>{children}</View>
  );
  Trigger.Icon = () => null;
  Trigger.Label = ({ children }: any) => {
    mockNativeLabels.push(children);
    return <Text>{children}</Text>;
  };
  NativeTabs.Trigger = Trigger;

  return { NativeTabs };
});

jest.mock('expo-router', () => {
  const React = require('react');
  const { View } = require('react-native');

  const Tabs: any = ({ children }: any) => <View testID="classic-tabs">{children}</View>;
  Tabs.Screen = ({ name, options }: any) => {
    mockClassicTabs.push([name, options.title]);
    return <View testID={`classic-tab-screen-${name}`} />;
  };

  return { Tabs };
});

jest.mock('@/hooks/useColors', () => ({
  useColors: () => ({
    background: '#ffffff',
    border: '#dddddd',
    foreground: '#111111',
    mutedForeground: '#777777',
    primary: '#6633cc',
    primaryForeground: '#ffffff',
  }),
}));

jest.mock('@expo/vector-icons', () => ({
  Feather: () => null,
}));

jest.mock('expo-blur', () => ({
  BlurView: () => null,
}));

jest.mock('expo-symbols', () => ({
  SymbolView: () => null,
}));

import TabLayout from '../app/(tabs)/_layout';

const expectedTabs = [
  ['index', 'Home'],
  ['browse', 'Browse'],
  ['watchlist', 'Watchlist'],
  ['my-shows', 'My Shows'],
  ['profile', 'Profile'],
];

describe('TabLayout', () => {
  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
    mockNativeRoutes.length = 0;
    mockNativeLabels.length = 0;
    mockClassicTabs.length = 0;
  });

  it('renders the five aligned NativeTabs triggers when liquid glass is available', async () => {
    mockIsLiquidGlassAvailable.mockReturnValue(true);

    const { getByTestId, queryByTestId } = await render(<TabLayout />);

    expect(getByTestId('native-tabs')).toBeTruthy();
    expect(queryByTestId('classic-tabs')).toBeNull();
    expect(mockNativeRoutes).toHaveLength(5);
    expect(mockNativeLabels).toHaveLength(5);
    expect(mockNativeRoutes.map((route, index) => [route, mockNativeLabels[index]])).toEqual(
      expectedTabs,
    );
  });

  it('renders the five aligned classic tab screens without liquid glass', async () => {
    mockIsLiquidGlassAvailable.mockReturnValue(false);

    const { getByTestId, queryByTestId } = await render(<TabLayout />);

    expect(getByTestId('classic-tabs')).toBeTruthy();
    expect(queryByTestId('native-tabs')).toBeNull();
    expect(mockClassicTabs).toHaveLength(5);
    expect(mockClassicTabs).toEqual(expectedTabs);
  });
});