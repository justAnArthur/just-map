import type { ExpressionSpecification } from 'maplibre-gl'

type RGB = [number, number, number]

const VIRIDIS: Array<[number, RGB]> = [
  [0, [68, 1, 84]],
  [25, [59, 82, 139]],
  [50, [33, 145, 140]],
  [80, [94, 201, 98]],
  [110, [253, 231, 37]],
  [135, [253, 231, 37]],
]

/** a named palette or an even ramp of hex colors */
export type Palette = 'viridis' | string[]

const hex = (c: string): RGB => [1, 3, 5].map(k => parseInt(c.slice(k, k + 2), 16)) as RGB

function ramp(stops: Array<[number, RGB]>) {
  return (v: number) => {
    const x = Math.min(stops[stops.length - 1][0], Math.max(0, v))
    let i = 1
    while (i < stops.length - 1 && stops[i][0] < x) i++

    const [x0, c0] = stops[i - 1]
    const [x1, c1] = stops[i]
    const u = (x - x0) / (x1 - x0 || 1)
    const ch = (k: number) => Math.round(c0[k] + (c1[k] - c0[k]) * u)
    return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`
  }
}

/** color sampler over [0,1] built from a palette */
export function paletteSampler(palette: Palette): (v: number) => string {
  if (palette === 'viridis') {
    const f = ramp(VIRIDIS)
    return v => f(v * 135)
  }

  return ramp(palette.map((c, i) => [i, hex(c)]))
}

/** `match` on a feature property; an empty map collapses to the fallback */
export function matchColor(property: string, colors: Record<string, string>, fallback: string) {
  const pairs = Object.entries(colors).flat()
  if (!pairs.length) return fallback

  // the spec typings can't express match's variadic label/output pairs
  return ['match', ['get', property], ...pairs, fallback] as unknown as ExpressionSpecification
}
