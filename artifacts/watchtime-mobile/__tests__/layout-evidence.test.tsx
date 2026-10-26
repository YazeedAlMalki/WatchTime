import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { isLoaded, isLoading } from 'expo-font';
import { EvidenceText, LayoutEvidence } from '../components/layout-evidence';

jest.mock('expo-font', () => ({
  isLoaded: jest.fn(() => true),
  isLoading: jest.fn(() => false),
}));

const previousFlag = process.env.EXPO_PUBLIC_LAYOUT_EVIDENCE;
afterEach(() => {
  cleanup();
  jest.useRealTimers();
  process.env.EXPO_PUBLIC_LAYOUT_EVIDENCE = previousFlag;
  jest.clearAllMocks();
});

test('normal development has no evidence node or measurement handlers', async () => {
  delete process.env.EXPO_PUBLIC_LAYOUT_EVIDENCE;
  const screen = await render(<>
    <EvidenceText evidenceId="browse-chip-All" testID="label">All</EvidenceText>
    <LayoutEvidence screen="browse" />
  </>);
  expect(screen.queryByTestId('layout-evidence-browse')).toBeNull();
  expect(screen.getByTestId('label').props.onTextLayout).toBeUndefined();
  expect(isLoaded).not.toHaveBeenCalled();
});

test('opt-in captures native layout, fonts and content readiness without label contents', async () => {
  process.env.EXPO_PUBLIC_LAYOUT_EVIDENCE = '1';
  jest.useFakeTimers();
  const screen = await render(<>
    <EvidenceText evidenceId="browse-chip-All" testID="label">All</EvidenceText>
    <LayoutEvidence screen="browse" contentReady />
  </>);
  await fireEvent(screen.getByTestId('label'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 100, height: 20 } },
  });
  await fireEvent(screen.getByTestId('label'), 'textLayout', {
    nativeEvent: { lines: [{ text: 'private label', x: 0, y: 0, width: 90, height: 20 }] },
  });
  await act(async () => { jest.advanceTimersByTime(500); });
  const metadata = JSON.parse(screen.getByTestId('layout-evidence-browse').props.accessibilityLabel);
  expect(metadata.screen).toBe('browse');
  expect(metadata.contentReady).toBe(true);
  expect(metadata.logicalWidth).toBeGreaterThan(0);
  expect(metadata.fontScale).toBeGreaterThan(0);
  expect(Object.values(metadata.fonts)).toEqual(['loaded', 'loaded', 'loaded', 'loaded']);
  expect(metadata.measurements['browse-chip-All']).toEqual({
    width: 100, height: 20, lines: [{ x: 0, y: 0, width: 90, height: 20 }],
  });
  expect(JSON.stringify(metadata)).not.toContain('private label');
});

test('loading and fallback fonts are distinguishable; title scope excludes Browse measurements', async () => {
  process.env.EXPO_PUBLIC_LAYOUT_EVIDENCE = '1';
  jest.mocked(isLoaded).mockReturnValue(false);
  jest.mocked(isLoading).mockReturnValueOnce(true).mockReturnValue(false);
  const screen = await render(<LayoutEvidence screen="title" titleId={12} />);
  const metadata = JSON.parse(screen.getByTestId('layout-evidence-title').props.accessibilityLabel);
  expect(metadata.titleId).toBe(12);
  expect(Object.values(metadata.fonts)).toContain('loading');
  expect(Object.values(metadata.fonts)).toContain('fallback');
  expect(metadata.measurements).toEqual({});
});
