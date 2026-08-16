/**
 * WatchTime brand tokens — mirrors artifacts/watchtime/src/index.css dark theme.
 * The app is dark-first: both schemes use the same dark palette so the brand
 * stays consistent (TVTime look: deep navy-black surfaces, amber/gold primary).
 */

const palette = {
  text: '#F5F5F5',
  tint: '#F5C619',

  background: '#0C0C12',
  foreground: '#F5F5F5',

  card: '#16161D',
  cardForeground: '#F5F5F5',

  primary: '#F5C619',
  primaryForeground: '#0A0A0F',

  secondary: '#23232F',
  secondaryForeground: '#F5F5F5',

  muted: '#1E1E29',
  mutedForeground: '#818898',

  accent: '#23232F',
  accentForeground: '#F5F5F5',

  destructive: '#EF4444',
  destructiveForeground: '#FFFFFF',

  border: '#23232F',
  input: '#23232F',

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
