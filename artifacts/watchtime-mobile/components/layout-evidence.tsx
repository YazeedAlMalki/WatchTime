/**
 * Development-only Appium instrumentation. No network, account data or auth
 * bypass. Enable before starting Metro: EXPO_PUBLIC_LAYOUT_EVIDENCE=1.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Platform, Text, useWindowDimensions, type TextProps } from 'react-native';
import { isLoaded, isLoading } from 'expo-font';

export function layoutEvidenceEnabled() {
  return typeof __DEV__ !== 'undefined' && __DEV__ &&
    process.env.EXPO_PUBLIC_LAYOUT_EVIDENCE === '1';
}

type Measurement = {
  width: number;
  height: number;
  lines: { x: number; y: number; width: number; height: number }[];
};
const measurements = new Map<string, Partial<Measurement>>();
const fonts = ['Inter_400Regular', 'Inter_500Medium', 'Inter_600SemiBold', 'Inter_700Bold'];

function ProbedText({ evidenceId, ...props }: TextProps & { evidenceId: string }) {
  const record = useRef<Partial<Measurement>>({});
  useEffect(() => () => { measurements.delete(evidenceId); }, [evidenceId]);
  return (
    <Text
      {...props}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        Object.assign(record.current, { width, height });
        measurements.set(evidenceId, { ...record.current });
        props.onLayout?.(event);
      }}
      onTextLayout={(event) => {
        record.current.lines = event.nativeEvent.lines.map(({ x, y, width, height }) => (
          { x, y, width, height }
        ));
        measurements.set(evidenceId, { ...record.current });
        props.onTextLayout?.(event);
      }}
    />
  );
}

export function EvidenceText({ evidenceId, ...props }: TextProps & { evidenceId: string }) {
  return layoutEvidenceEnabled()
    ? <ProbedText {...props} evidenceId={evidenceId} />
    : <Text {...props} />;
}

type EvidenceProps = { screen: 'browse' | 'title'; contentReady?: boolean; titleId?: number };

function ActiveEvidence({ screen, contentReady = true, titleId }: EvidenceProps) {
  const dimensions = useWindowDimensions();
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(timer);
  }, []);
  const data = JSON.stringify({
    version: 1,
    screen,
    contentReady,
    titleId,
    platform: Platform.OS,
    osVersion: String(Platform.Version),
    logicalWidth: dimensions.width,
    logicalHeight: dimensions.height,
    fontScale: dimensions.fontScale,
    pixelRatio: dimensions.scale,
    fonts: Object.fromEntries(fonts.map((font) => [
      font, isLoaded(font) ? 'loaded' : isLoading(font) ? 'loading' : 'fallback',
    ])),
    measurements: Object.fromEntries([...measurements].filter(([id]) => id.startsWith(`${screen}-`))),
  });
  return (
    <Text
      testID={`layout-evidence-${screen}`}
      accessible
      accessibilityLabel={data}
      pointerEvents="none"
      // A non-interactive, effectively invisible native accessibility node.
      // It does not change layout and is excluded entirely from release builds.
      style={{ position: 'absolute', bottom: 0, left: 0, width: 1, height: 1, fontSize: 1, opacity: 0.01 }}
    >{data}</Text>
  );
}

export function LayoutEvidence(props: EvidenceProps) {
  return layoutEvidenceEnabled() ? <ActiveEvidence {...props} /> : null;
}
