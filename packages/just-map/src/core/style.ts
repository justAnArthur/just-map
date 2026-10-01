import type { StyleSpecification } from 'maplibre-gl'

export type Projection = 'globe' | 'mercator'

export type CameraOptions = {
  center?: [number, number]
  zoom?: number
  pitch?: number
  bearing?: number
  maxPitch?: number
  projection?: Projection
}

export type SkySpecification = NonNullable<StyleSpecification['sky']>

export const SKIES = {
  day: {
    'sky-color': '#35597e',
    'horizon-color': '#cfe0ee',
    'fog-color': '#8fa8bd',
    'sky-horizon-blend': 0.6,
    'horizon-fog-blend': 0.6,
    'fog-ground-blend': 0.75,
    'atmosphere-blend': 0.5,
  },
} as const satisfies Record<string, SkySpecification>

export type SkyPreset = keyof typeof SKIES

/** free vector base styles (OpenFreeMap) — no key required */
export const STYLE_PRESETS = {
  positron: 'https://tiles.openfreemap.org/styles/positron',
  liberty: 'https://tiles.openfreemap.org/styles/liberty',
  bright: 'https://tiles.openfreemap.org/styles/bright',
} as const

export type StyleBase = keyof typeof STYLE_PRESETS | (string & {}) | StyleSpecification

/** preset name or URL → the style URL maplibre fetches */
export const styleUrl = (base: string) => (STYLE_PRESETS as Record<string, string>)[base] ?? base

export function buildStyle(camera: CameraOptions, sky: SkyPreset | SkySpecification | false): StyleSpecification {
  const style: StyleSpecification = {
    version: 8,
    projection: { type: camera.projection ?? 'globe' },
    sources: {},
    layers: [],
  }

  if (sky) style.sky = typeof sky === 'string' ? { ...SKIES[sky] } : sky
  return style
}

/**
 * The map's base style: a named preset or URL passes through to the map
 * constructor; an inline spec gets projection/sky merged in; undefined
 * builds the empty shell modules draw into.
 */
export function resolveStyle(
  base: StyleBase | undefined,
  camera: CameraOptions,
  sky: SkyPreset | SkySpecification | false,
): string | StyleSpecification {
  if (typeof base === 'string') return styleUrl(base)

  if (base) {
    const merged: StyleSpecification = {
      ...base,
      projection: { type: base.projection?.type ?? camera.projection ?? 'globe' },
    }
    if (!merged.sky && sky) merged.sky = typeof sky === 'string' ? { ...SKIES[sky] } : sky
    return merged
  }

  return buildStyle(camera, sky)
}
