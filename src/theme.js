// The Kidzonia look, expressed once.
//
// This file is the answer to "you will never achieve consistency": density,
// radius, weight and colour are decided HERE, in component defaults, instead of
// being re-invented with inline styles on every screen. A page should almost
// never need to say how big a button is.
//
// The palette is the one the app already had (src/index.css) — adopting a
// component library should not cost the product its identity.
import { createTheme, rem } from '@mantine/core'

// Mantine wants ten shades per colour. These are hand-tuned around the original
// tokens rather than generated, so --marmalade #f4772e is still exactly the
// orange people recognise (index 6, which is what `primaryShade` selects).
const marmalade = [
  '#fff4ed', '#fdeadd', '#fbd2b8', '#f8b78e', '#f69f6a', '#f58f52',
  '#f4772e', '#d95f14', '#c25411', '#a9470c',
]
const teal = [
  '#eefaf7', '#dcf2ee', '#b6e5dc', '#8dd7c9', '#6bcbb9', '#54c3af',
  '#12907e', '#0f7d6d', '#0c6a5c', '#09564b',
]
const sun = [
  '#fffaeb', '#fdf3d9', '#fbe5ad', '#f9d67e', '#f7ca57', '#f6c243',
  '#f5b93c', '#d99f28', '#ad7a12', '#8a610d',
]
const berry = [
  '#fef1f1', '#fde5e5', '#fbc4c5', '#f8a1a3', '#f58386', '#f27074',
  '#e5484d', '#cc3d42', '#b03337', '#93292c',
]
const sky = [
  '#eff5fd', '#e3edfb', '#c2d8f5', '#9ec1ee', '#7faee9', '#699fe4',
  '#3b76d0', '#3468b8', '#2c5a9e', '#244a83',
]
const ink = [
  '#f7f6f9', '#ece9f1', '#d4cee0', '#bab2ce', '#a49abd', '#948bb0',
  '#8b84a3', '#574f6e', '#3f3856', '#2b2440',
]

export const theme = createTheme({
  primaryColor: 'marmalade',
  primaryShade: 6,
  colors: { marmalade, teal, sun, berry, sky, ink },

  fontFamily: "'Nunito Sans', 'Segoe UI', sans-serif",
  headings: {
    fontFamily: "'Baloo 2', 'Trebuchet MS', sans-serif",
    sizes: {
      h1: { fontSize: rem(21), fontWeight: '700' },
      h2: { fontSize: rem(17), fontWeight: '700' },
      h3: { fontSize: rem(15), fontWeight: '700' },
    },
  },

  defaultRadius: 'md',
  radius: { sm: rem(9), md: rem(14), lg: rem(18) },
  shadows: {
    sm: '0 1px 2px rgba(43, 36, 64, 0.06), 0 6px 20px -8px rgba(43, 36, 64, 0.12)',
    md: '0 4px 10px rgba(43, 36, 64, 0.08), 0 18px 40px -12px rgba(43, 36, 64, 0.22)',
  },

  other: {
    paper: '#faf6ef',
    line: '#ece5d8',
    inkSoft: '#574f6e',
    inkFaint: '#8b84a3',
  },

  // ---- the density decisions, made once ----
  components: {
    Button: {
      defaultProps: { radius: 'sm' },
      styles: { root: { fontWeight: 700 } },
    },
    Card: {
      defaultProps: { radius: 'md', padding: 'lg', withBorder: false, shadow: 'sm' },
      styles: { root: { backgroundColor: '#fff' } },
    },
    Paper: { defaultProps: { radius: 'md' } },
    Modal: {
      defaultProps: { radius: 'md', centered: true, overlayProps: { blur: 2, opacity: 0.35 } },
      styles: { title: { fontFamily: "'Baloo 2', sans-serif", fontWeight: 700 } },
    },
    // Inputs are the densest thing in a CRM; one size for all of them.
    TextInput: { defaultProps: { size: 'sm', radius: 'sm' } },
    Textarea: { defaultProps: { size: 'sm', radius: 'sm', autosize: true, minRows: 2 } },
    Select: { defaultProps: { size: 'sm', radius: 'sm', checkIconPosition: 'right' } },
    MultiSelect: { defaultProps: { size: 'sm', radius: 'sm' } },
    NumberInput: { defaultProps: { size: 'sm', radius: 'sm' } },
    DateInput: { defaultProps: { size: 'sm', radius: 'sm', valueFormat: 'DD MMM YYYY' } },
    TimeInput: { defaultProps: { size: 'sm', radius: 'sm' } },
    Checkbox: { defaultProps: { size: 'sm', radius: 'sm' } },
    Radio: { defaultProps: { size: 'sm' } },
    Switch: { defaultProps: { size: 'sm' } },

    Badge: {
      defaultProps: { radius: 'sm', variant: 'light', size: 'sm' },
      styles: { root: { fontWeight: 700, textTransform: 'none' } },
    },
    Table: {
      defaultProps: { verticalSpacing: 'xs', horizontalSpacing: 'md', highlightOnHover: true, striped: false },
    },
    Alert: { defaultProps: { radius: 'md', variant: 'light' } },
    Tabs: { defaultProps: { keepMounted: false } },
    Tooltip: { defaultProps: { withArrow: true, openDelay: 300 } },
  },
})

// State colours, so nothing invents its own meaning for a hue. Grey is normal,
// amber wants attention, red is late, green is finished.
export const TONE = {
  neutral: 'ink',
  attention: 'marmalade',
  late: 'berry',
  done: 'teal',
  info: 'sky',
  waiting: 'sun',
}
