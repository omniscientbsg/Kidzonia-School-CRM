import { createTheme } from '@mantine/core';
import type { CSSVariablesResolver } from '@mantine/core';
import type { MantineColorsTuple } from '@mantine/core';

// Shades around the brand blue #1A63C6 (index 6), per brief 7.2.
const brand: MantineColorsTuple = [
  '#e8f0fc',
  '#d0e0f8',
  '#a3c1f0',
  '#72a0e8',
  '#4a84e0',
  '#2f72da',
  '#1a63c6',
  '#1354ad',
  '#0c4898',
  '#023b83',
];

// The one accent, used only for things needing action (overdue, logout block).
const amber: MantineColorsTuple = [
  '#fdf6e3',
  '#fcefd0',
  '#f8dd9e',
  '#f3c969',
  '#efb83d',
  '#ecad21',
  '#e3a11a',
  '#c88c0e',
  '#b27b05',
  '#9a6800',
];

export const theme = createTheme({
  primaryColor: 'brand',
  // Dark mode keeps a deep shade so white button text stays at 4.5:1 (audit D5).
  primaryShade: { light: 6, dark: 7 },
  colors: { brand, amber },
  fontFamily: '"Figtree Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  headings: {
    fontFamily: '"Bricolage Grotesque Variable", ui-sans-serif, system-ui, sans-serif',
    fontWeight: '600',
  },
  defaultRadius: 'md',
  cursorType: 'pointer',
  // Drawers, menus and toasts don't slide or fade when the device asks for less motion (D6).
  respectReducedMotion: true,
  components: {
    Button: { defaultProps: { radius: 'md' } },
    // Icon-only close buttons need a name for screen readers.
    Modal: { defaultProps: { closeButtonProps: { 'aria-label': 'Close' } } },
    Drawer: { defaultProps: { closeButtonProps: { 'aria-label': 'Close' } } },
  },
});

/** Mantine's default dimmed grey fails 4.5:1 contrast on our page background. */
export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {},
  light: { '--mantine-color-dimmed': '#5b677e' },
  dark: { '--mantine-color-dimmed': '#8d99af' },
});
