export type JustMapTheme = {
  /** interaction color — hovers, active buttons, sliders */
  accent?: string
  /** text/icon color on accent surfaces */
  accentFg?: string
  /** control surface color */
  bg?: string
  /** control text/icon color */
  fg?: string
  border?: string
  radius?: string
  /** floating bar surface (allows translucency) */
  barBg?: string
  shadow?: string
}

type ThemeVar =
  | '--jm-accent'
  | '--jm-accent-fg'
  | '--jm-bg'
  | '--jm-fg'
  | '--jm-border'
  | '--jm-radius'
  | '--jm-bar-bg'
  | '--jm-bar-shadow'

/** theme tokens → CSS variables (applied on the engine container) */
export function themeVars(theme: JustMapTheme): Partial<Record<ThemeVar, string>> {
  const vars: Partial<Record<ThemeVar, string>> = {}

  if (theme.accent !== undefined) vars['--jm-accent'] = theme.accent
  if (theme.accentFg !== undefined) vars['--jm-accent-fg'] = theme.accentFg
  if (theme.bg !== undefined) vars['--jm-bg'] = theme.bg
  if (theme.fg !== undefined) vars['--jm-fg'] = theme.fg
  if (theme.border !== undefined) vars['--jm-border'] = theme.border
  if (theme.radius !== undefined) vars['--jm-radius'] = theme.radius
  if (theme.barBg !== undefined) vars['--jm-bar-bg'] = theme.barBg
  if (theme.shadow !== undefined) vars['--jm-bar-shadow'] = theme.shadow

  return vars
}
