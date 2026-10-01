import type { ModuleFactory, ModuleSpec } from '../core/module'
import type { CameraOptions, SkyPreset, SkySpecification } from '../core/style'
import { Render, Style, type RenderOptions, type StyleOptions } from '../modules/render'
import { Buildings, Terrain, type BuildingsOptions, type TerrainOptions } from '../modules/terrain'
import { Breadcrumbs, Tracks, type BreadcrumbsOptions, type TracksOptions } from '../modules/data'
import { FollowCam, Playback, type FollowCamOptions, type PlaybackOptions } from '../modules/animation'
import { Gestures, Navigation, type GesturesOptions, type NavigationOptions } from '../modules/navigation'

export type PresetBundle = {
  modules: ModuleSpec<any>[]
  camera?: CameraOptions
  sky?: SkyPreset | SkySpecification | false
}

/** per-module option overrides, keyed by the lowercased module name */
export type PresetOverrides = {
  render?: Partial<RenderOptions>
  style?: Partial<StyleOptions>
  terrain?: Partial<TerrainOptions>
  buildings?: Partial<BuildingsOptions>
  tracks?: Partial<TracksOptions>
  breadcrumbs?: Partial<BreadcrumbsOptions>
  playback?: Partial<PlaybackOptions>
  followCam?: Partial<FollowCamOptions>
  gestures?: Partial<GesturesOptions>
  navigation?: Partial<NavigationOptions>
}

type Slot = [keyof PresetOverrides, ModuleFactory<any>, PresetOverrides[keyof PresetOverrides]] | null

function bundle(slots: Slot[], camera: CameraOptions, sky: PresetBundle['sky'], overrides: PresetOverrides = {}): PresetBundle {
  const modules = slots
    .filter((s): s is Exclude<Slot, null> => !!s)
    .map(([key, factory, preset]) => factory({ ...preset, ...overrides[key] }))

  return { modules, camera, sky }
}

/** The Google-Earth look: globe, dim satellite, 3D terrain + buildings, rotate gestures. */
export const googleEarth = (overrides: PresetOverrides = {}) =>
  bundle(
    [
      ['render', Render, { provider: 'satellite', dim: true } as Partial<RenderOptions>],
      ['terrain', Terrain, { exaggeration: 1.8, hillshade: true } as Partial<TerrainOptions>],
      ['buildings', Buildings, {}],
      ['gestures', Gestures, { rotate3d: { speed: 0.3, pitchStep: 0.25 } } as Partial<GesturesOptions>],
      ['navigation', Navigation, {}],
    ],
    { projection: 'globe', pitch: 68, bearing: -35, maxPitch: 80 },
    'day',
    overrides,
  )

/** Cheap flat 2D view: mercator, light vector streets, no terrain. */
export const flat = (overrides: PresetOverrides = {}) =>
  bundle(
    [
      ['style', Style, { base: 'positron' } as Partial<StyleOptions>],
      ['navigation', Navigation, {}],
    ],
    { projection: 'mercator', pitch: 0 },
    false,
    overrides,
  )

/** Trip replay: satellite + terrain, tracks that fit on select, playback with follow cam. */
export const history = (overrides: PresetOverrides = {}) =>
  bundle(
    [
      ['render', Render, { provider: 'satellite', dim: true } as Partial<RenderOptions>],
      ['terrain', Terrain, { exaggeration: 1.5, hillshade: true } as Partial<TerrainOptions>],
      ['tracks', Tracks, { styling: { glow: true, width: 6.5, dash: true } } as Partial<TracksOptions>],
      ['playback', Playback, { follow: true, wallTime: 150 } as Partial<PlaybackOptions>],
      ['followCam', FollowCam, { pitch: 60, zoomFloor: 14 } as Partial<FollowCamOptions>],
      ['gestures', Gestures, { rotate3d: { speed: 0.3, pitchStep: 0.25 } } as Partial<GesturesOptions>],
      ['navigation', Navigation, {}],
    ],
    { projection: 'globe', pitch: 58, bearing: -18, maxPitch: 80 },
    'day',
    overrides,
  )

/** Live tracking: follow cam on, no fitBounds, raw breadcrumbs visible. */
export const realtime = (overrides: PresetOverrides = {}) =>
  bundle(
    [
      ['render', Render, { provider: 'satellite', dim: true } as Partial<RenderOptions>],
      ['terrain', Terrain, { exaggeration: 1.5, hillshade: true } as Partial<TerrainOptions>],
      ['tracks', Tracks, { fit: false } as Partial<TracksOptions>],
      ['breadcrumbs', Breadcrumbs, { visible: true } as Partial<BreadcrumbsOptions>],
      ['followCam', FollowCam, { pitch: 60, zoomFloor: 14 } as Partial<FollowCamOptions>],
      ['gestures', Gestures, { rotate3d: { speed: 0.3, pitchStep: 0.25 } } as Partial<GesturesOptions>],
      ['navigation', Navigation, {}],
    ],
    { projection: 'globe', pitch: 55, maxPitch: 80 },
    'day',
    overrides,
  )

export const presets = { googleEarth, flat, history, realtime }
