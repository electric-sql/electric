/**
 * Token set mirrored from `packages/agents-server-ui/src/ui/tokens.css`.
 *
 * Where the web tokens use `color-mix(... transparent)` we precompute the
 * resulting `rgba(...)` value. RN can't evaluate CSS variables or color
 * functions at runtime so the token table is the single source of truth
 * for both the native shell and the embedded web bundle.
 */

export type ColorScheme = `light` | `dark`

export type Tokens = {
  scheme: ColorScheme

  bg: string
  bgSubtle: string
  surface: string
  surfaceRaised: string
  inputBg: string
  bgHover: string
  chipBg: string
  overlay: string

  border1: string
  border2: string
  border3: string
  divider: string
  overlayBorder: string

  text1: string
  text2: string
  text3: string
  text4: string
  textOnAccent: string

  accent9: string
  accent10: string
  accent11: string
  accent12: string
  accentText: string
  accentA2: string
  accentA3: string
  accentA4: string
  accentA6: string

  red9: string
  red11: string
  redA2: string
  redA3: string
  green9: string
  green11: string
  greenA3: string
  amber9: string
  amber11: string
  amberA3: string
  blue9: string
  blue11: string
  blueA3: string
  yellow9: string

  gray7: string
  gray8: string
  gray9: string
  gray11: string
  gray12: string

  shadow1: string
  shadow2: string
}

export const lightTokens: Tokens = {
  scheme: `light`,

  bg: `#f7f7f5`,
  bgSubtle: `#f0efed`,
  surface: `#ffffff`,
  surfaceRaised: `#ffffff`,
  inputBg: `#ffffff`,
  bgHover: `rgba(30, 31, 36, 0.10)`,
  chipBg: `#ffffff`,
  overlay: `rgba(15, 15, 30, 0.45)`,

  border1: `rgba(30, 31, 36, 0.14)`,
  border2: `rgba(30, 31, 36, 0.18)`,
  border3: `rgba(30, 31, 36, 0.22)`,
  divider: `#e4e3e0`,
  overlayBorder: `rgba(30, 31, 36, 0.11)`,

  text1: `#1a1a2e`,
  text2: `#5c5c6e`,
  text3: `#999999`,
  text4: `rgba(26, 26, 46, 0.4)`,
  textOnAccent: `#ffffff`,

  accent9: `#1a1a2e`,
  accent10: `#3a3a56`,
  accent11: `#1a1a2e`,
  accent12: `#0f0f1e`,
  accentText: `#1a1a2e`,
  accentA2: `rgba(26, 26, 46, 0.08)`,
  accentA3: `rgba(26, 26, 46, 0.14)`,
  accentA4: `rgba(26, 26, 46, 0.22)`,
  accentA6: `rgba(26, 26, 46, 0.44)`,

  red9: `#dc2626`,
  red11: `#b91c1c`,
  redA2: `rgba(220, 38, 38, 0.10)`,
  redA3: `rgba(220, 38, 38, 0.15)`,
  green9: `#059669`,
  green11: `#047857`,
  greenA3: `rgba(5, 150, 105, 0.15)`,
  amber9: `#d97706`,
  amber11: `#b45309`,
  amberA3: `rgba(217, 119, 6, 0.15)`,
  blue9: `#3b82f6`,
  blue11: `#1d4ed8`,
  blueA3: `rgba(59, 130, 246, 0.15)`,
  yellow9: `#eab308`,

  gray7: `#cdced7`,
  gray8: `#b9bbc6`,
  gray9: `#8b8d98`,
  gray11: `#62636c`,
  gray12: `#1e1f24`,

  shadow1: `rgba(15, 15, 30, 0.04)`,
  shadow2: `rgba(15, 15, 30, 0.08)`,
}

export const darkTokens: Tokens = {
  scheme: `dark`,

  bg: `#111318`,
  bgSubtle: `#16181f`,
  surface: `#1a1d27`,
  surfaceRaised: `#22252f`,
  inputBg: `#22252f`,
  bgHover: `#2d3142`,
  chipBg: `#22252f`,
  overlay: `rgba(0, 0, 0, 0.55)`,

  border1: `rgba(255, 255, 255, 0.11)`,
  border2: `rgba(255, 255, 255, 0.19)`,
  border3: `rgba(255, 255, 255, 0.31)`,
  divider: `#2a2d38`,
  overlayBorder: `rgba(237, 237, 238, 0.12)`,

  text1: `rgba(255, 255, 245, 0.92)`,
  text2: `rgba(235, 235, 245, 0.80)`,
  text3: `rgba(235, 235, 245, 0.68)`,
  text4: `rgba(235, 235, 245, 0.50)`,
  textOnAccent: `#1a1a1a`,

  accent9: `#75fbfd`,
  accent10: `#56e8ea`,
  accent11: `#75fbfd`,
  accent12: `#b8fdfe`,
  accentText: `#75fbfd`,
  accentA2: `rgba(117, 251, 253, 0.08)`,
  accentA3: `rgba(117, 251, 253, 0.22)`,
  accentA4: `rgba(117, 251, 253, 0.32)`,
  accentA6: `rgba(117, 251, 253, 0.58)`,

  red9: `#f87171`,
  red11: `#fca5a5`,
  redA2: `rgba(248, 113, 113, 0.14)`,
  redA3: `rgba(248, 113, 113, 0.22)`,
  green9: `#34d399`,
  green11: `#6ee7b7`,
  greenA3: `rgba(52, 211, 153, 0.22)`,
  amber9: `#fbbf24`,
  amber11: `#fcd34d`,
  amberA3: `rgba(251, 191, 36, 0.22)`,
  blue9: `#60a5fa`,
  blue11: `#93c5fd`,
  blueA3: `rgba(96, 165, 250, 0.22)`,
  yellow9: `#facc15`,

  gray7: `#2d3142`,
  gray8: `#3a3f52`,
  gray9: `#545a6e`,
  gray11: `#b8bcc6`,
  gray12: `#ededee`,

  shadow1: `rgba(0, 0, 0, 0.40)`,
  shadow2: `rgba(0, 0, 0, 0.50)`,
}

export const tokensByScheme: Record<ColorScheme, Tokens> = {
  light: lightTokens,
  dark: darkTokens,
}

/** Mirrors `--ds-space-*` 1:1. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  xxxxl: 48,
}

/** Mirrors `--ds-radius-*`. */
export const radii = {
  xs: 3,
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
  xxl: 16,
  pill: 999,
}

/**
 * Mirrors `--ds-text-*`. Line heights are absolute pixels rather than the
 * web's unit-less multipliers because RN requires concrete `lineHeight`
 * values when set on text styles.
 */
export const fontSize = {
  xs: 11,
  sm: 13,
  base: 14,
  lg: 16,
  xl: 18,
  xxl: 22,
  xxxl: 28,
}

export const lineHeight = {
  xs: 16,
  sm: 19,
  base: 22,
  lg: 24,
  xl: 25,
  xxl: 30,
  xxxl: 35,
}

/** Density tokens — match `--ds-row-height-*`. */
export const rowHeight = {
  sm: 24,
  md: 28,
  lg: 36,
  xl: 44,
}
