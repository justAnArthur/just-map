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
