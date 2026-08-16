/**
 * WatchTime brand tokens — mirrors artifacts/watchtime/src/index.css dark theme.
 * The app is dark-first: both schemes use the same dark palette so the brand
 * stays consistent (dark navy surfaces, crimson red primary).
 */

const palette = {
  text: '#FBF9F6',
  tint: '#C91D39',

  background: '#121724',
  foreground: '#FBF9F6',

  card: '#171C26',
  cardForeground: '#FBF9F6',

  primary: '#C91D39',
  primaryForeground: '#FFFFFF',

  secondary: '#1C2331',
  secondaryForeground: '#E8E6E1',

  muted: '#1C2331',
  mutedForeground: '#9AA3B2',

  accent: '#232B3B',
  accentForeground: '#E8E6E1',

  destructive: '#E5484D',
  destructiveForeground: '#FFFFFF',

  border: '#29303D',
  input: '#29303D',

  // Extra semantic colors for safety severity chips (match web badges)
  severityNone: '#3FB68B',
  severityMild: '#D8B24A',
  severityModerate: '#E08A3C',
  severitySevere: '#E5484D',
};

const colors = {
  light: palette,
  dark: palette,
  radius: 12,
};

export default colors;
