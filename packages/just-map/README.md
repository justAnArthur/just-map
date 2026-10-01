# @justanarthur/just-map

A modular 3D map library on [MapLibre GL JS](https://maplibre.org/) — Swiper-style composition.
Import the domains you need, configure modules inline with their settings, and the map assembles itself.

## Install

```sh
npm install @justanarthur/just-map maplibre-gl react
```

Peer dependencies: `maplibre-gl ^5` (required) and `react ^19` (only if you use `just-map/react`).
The library ships zero CSS — import MapLibre's own stylesheet once in your app entry:

```ts
import 'maplibre-gl/dist/maplibre-gl.css'
```

## Quick start (React)

```tsx
import { JustMap } from '@justanarthur/just-map/react'
import { Render } from '@justanarthur/just-map/modules/render'
import { Terrain, Buildings } from '@justanarthur/just-map/modules/terrain'
import { Tracks } from '@justanarthur/just-map/modules/data'
import { Playback, FollowCam } from '@justanarthur/just-map/modules/animation'
import { Gestures } from '@justanarthur/just-map/modules/navigation'
import 'maplibre-gl/dist/maplibre-gl.css'

<JustMap
  modules={[
    Render({ provider: 'satellite', dim: true }),
    Terrain({ exaggeration: 1.8 }),          // provides capability "3d"
    Buildings(),
    Tracks({ data, colorBy: { property: 'speed', palette: 'viridis' } }),
    Playback({ follow: true }),
    FollowCam({ pitch: 60 }),
    Gestures({ rotate3d: { speed: 0.3 } }),   // rotate3d needs "3d"
  ]}
  camera={{ pitch: 68, projection: 'globe' }}
/>
```

## Quick start (vanilla)

Same module factories, same engine (`@justanarthur/just-map/core`):

```ts
import { JustMapEngine } from '@justanarthur/just-map/core'
import { Render } from '@justanarthur/just-map/modules/render'
import { Terrain } from '@justanarthur/just-map/modules/terrain'

const engine = new JustMapEngine('#map', { modules: [Render(), Terrain()] })
engine.ready.then(() => engine.map.flyTo({ center: [20.05, 49.1], zoom: 12 }))
```

## Quick start (preset)

One spread gives you a full opinionated setup — pick `googleEarth`, `flat`, `history` or `realtime`,
and override any module:

```tsx
import { presets } from '@justanarthur/just-map/presets'

<JustMap {...presets.googleEarth({ terrain: { exaggeration: 2 } })} />
```

For a full runnable app, see the `examples/` folder in the repo — `basic` is the styling playground
(map/hybrid/satellite switcher), `fleet` is a complete live + history tracking app.

## Packages

| Subpath | Exports |
|---|---|
| `@justanarthur/just-map/react` | `<JustMap>`, `useJustMap` |
| `@justanarthur/just-map/core` | `JustMapEngine` (vanilla engine + escape hatch: `engine.map`) |
| `@justanarthur/just-map/modules/render` | `Render`, `Style` |
| `@justanarthur/just-map/modules/terrain` | `Terrain`, `Buildings` |
| `@justanarthur/just-map/modules/data` | `Tracks`, `Breadcrumbs`, `Markers`, `ZoneEditor` |
| `@justanarthur/just-map/modules/animation` | `Playback`, `FollowCam` |
| `@justanarthur/just-map/modules/navigation` | `Gestures`, `Navigation` |
| `@justanarthur/just-map/presets` | `presets.googleEarth / flat / history / realtime` |
| `@justanarthur/just-map/theme.css` | theme tokens + `.jm-*` overlay classes |
| `@justanarthur/just-map/matching` | `snapToRoad`, `fromGpsFixes` |

Peer dependencies: `maplibre-gl ^5`, `react ^19` (optional — only for `@justanarthur/just-map/react`).

## Modules by domain

### render — the base scene

**`Render`** — raster basemap with a 3-tier LOD underlay (z6 floor + z8 + main) and a
far-field LOD cap (`setSourceTileLodParams`) so fast zoom-outs never show bare patches.

| Option | Default | Notes |
|---|---|---|
| `provider` | `'satellite'` | `'satellite'` (Esri), `'osm'`, or `'tiles'` + custom `tiles` URL |
| `dim` | `false` | brightness 0.72 / saturation −0.15 grading |
| `maxzoom` | `19` | |
| `lodTiers` | `true` | set `false` for a single source (vector styles, local tiles) |
| `attribution` | per provider | |
| `visible` | `true` | hide the imagery (map-type switching without remount) |

**`Style`** — vector base styles with live tweaks: the SnazzyMaps experience for MapLibre.

```tsx
Style({ base: 'positron', tweaks: [
  { match: 'water', paint: { 'fill-color': '#aadaff' } },
  { match: /label|name/, visibility: 'none' },
] })
```

| Option | Default | Notes |
|---|---|---|
| `base` | `'positron'` | `'positron' \| 'liberty' \| 'bright'` (free OpenFreeMap vector styles), any style URL, or a full style spec |
| `tweaks` | `[]` | `{ match: id/regex/fn, paint, layout, visibility }` applied to matching base layers |
| `hybrid` | `false` | keep only labels/main-roads/borders and draw them **above raster imagery** — pair with `Render({ provider: 'satellite' })` for the Google satellite-with-labels look (module order doesn't matter) |
| `hybridKeep` | `/label\|name\|^boundary_\|^highway_(major\|motorway)/` | which base layers survive hybrid mode |
| `visible` | `true` | hide the entire base (pure-satellite mode) |

Changing `base` at runtime swaps the style while preserving every other module's layers and sources. Map / Hybrid / Satellite / 3D switching is pure option changes — no remount (see the `basic` example). Works with `Terrain()`/`Buildings()` for 3D on any base.

Roadmap: `Graticule`.

### terrain — the 3D world

**`Terrain`** — provides capability **`3d`**. Raster-dem (AWS terrarium by default), guarded
`setTerrain` (no re-issue on unchanged exaggeration, so sliders don't flicker), hillshade relief.

| Option | Default |
|---|---|
| `demUrl` | AWS terrarium tiles |
| `maxzoom` | `12` — the DEM exists to z12; higher maxzoom starves covering |
| `exaggeration` | `1.8` |
| `hillshade` / `hillshadeExaggeration` | `true` / `0.35` |
| `enabled` | `true` | `false` detaches terrain (map-type switching without remount) |

**`Buildings`** — OSM 3D extrusions (OpenFreeMap planet tiles), `minzoom 14`, `opacity 0.7`.
Soft-depends on `3d`: renders flat extrusions without terrain.

Roadmap: `Contours`, slope shading.

### data — vector overlays

**`Tracks`** — path collection with per-vertex color gradients (lineMetrics), selection
choreography (idle/glow/active/dash layers), start/end markers, fit-on-select, click events.

| Option | Default |
|---|---|
| `data` | `[]` — `Track { id, name?, coords, times?, speeds?, properties? }` |
| `colorBy` | — `{ property: 'speed' \| string, palette: 'viridis' \| string[], max: 130 }` |
| `color` | `'#38bdf8'` (when no `colorBy`) |
| `selectedId` / `onSelect` | — |
| `styling` | `{ glow: true, width: 6.5, dash: true }` |
| `fit` | `{ padding: 90, pitch: 58, maxZoom: 13.5, duration: 2000 }`, `false` to disable |

**`Breadcrumbs`** — the raw GPS truth: sparse-fix line + dots overlay (`fixes`, `color`, `visible`).

**`Markers`** — a handful of DOM dots with optional plain-text popups (`points`, `fit`); vehicle
positions, points of interest.

**`ZoneEditor`** — interactive geofence editing: click the map to insert a vertex into the nearest
edge, drag vertices, click one to delete (`ring`, `readonly`, `color`, `onChange` per commit).
Undo/redo belongs to the consuming app.

Roadmap: `Clusters`, `Heatmap`.

### animation — motion

**`Playback`** — animates a vehicle dot along a track's time profile (binary-search sampler,
~120 ms progress events, wall-clock normalization so every trip replays in similar time).
`follow: true` needs **`FollowCam`**; without it playback runs unfollowed (one dev warning).

**`FollowCam`** — the follow camera as its own module, so live tracking can follow without a
timeline: `follow(coord, bearing)` with frame-parity throttling (30 fps camera at 60 Hz subject
updates), pitch applies only when `3d` is present, `zoomFloor` keeps context.

Roadmap: `FlightArc`, `Tour`.

### navigation — input & camera

**`Gestures`** — ⌘/Ctrl+drag rotate & tilt. `rotate3d: { speed, pitchStep }` — the tilt axis is
available only when capability `3d` (Terrain) is installed; otherwise it degrades to bearing-only
with one dev warning. Also `pan`, `zoomSpeed`, `keyboard`.

**`Navigation`** — compass/zoom controls (`visualizePitch` on) + `flyTo`/`easeTo` helpers.

Roadmap: `MiniMap`, `ScaleBar`, `Geolocation`.

## Theming — one button style

Import the stylesheet once, pass tokens, and every control follows — MapLibre's zoom/compass
buttons are restyled to match, and app-rendered overlays use the shared `.jm-*` classes.

```tsx
import '@justanarthur/just-map/theme.css'

<JustMap theme={{ accent: '#0ea5e9', radius: 10 }} modules={[...]} />
```

| Token | CSS variable | Default |
|---|---|---|
| `accent` / `accentFg` | `--jm-accent` / `--jm-accent-fg` | `#2563eb` / white |
| `bg` / `fg` / `border` | `--jm-bg` / `--jm-fg` / `--jm-border` | white / `#0f172a` / `#cbd5e1` |
| `radius` | `--jm-radius` | `8px` |
| `barBg` / `shadow` | `--jm-bar-bg` / `--jm-bar-shadow` | translucent white / soft |

Overlay classes for app controls (playback bars, editor toolbars):
`.jm-bar` (floating control bar), `.jm-btn` (icon button; `.active` = accent),
`.jm-range` (accent slider), `.jm-pill` (badge). `Navigation({ className })` adds
classes to the control container as a fully-custom escape hatch — `engine.setTheme()`
restyles at runtime.

## Dependencies between modules

Modules declare `provides` (capability tags), `requires` (hard — engine throws at init) and
`uses` (soft — features degrade with one dev warning naming what's missing):

- `Terrain` → provides `3d`
- `Gestures.rotate3d`, `Playback.follow` → use `3d` / `FollowCam` respectively

Module order in the `modules` array is layer order: `Render` before `Tracks`, etc.

## Presets (`@justanarthur/just-map/presets`)

```tsx
<JustMap {...presets.googleEarth({ terrain: { exaggeration: 2 } })} />
```

- **googleEarth** — globe, pitch 68, dim satellite, terrain ×1.8, buildings, rotate gestures
- **flat** — mercator, pitch 0, OSM streets; the cheap 2D view
- **history** — trip replay: fit-on-select tracks, playback + follow cam
- **realtime** — live tracking: follow cam, no fitBounds, breadcrumbs visible

## From GPS coordinates to road-snapped routes (`@justanarthur/just-map/matching`)

```ts
import { fromGpsFixes } from '@justanarthur/just-map/matching'

const track = await fromGpsFixes(fixes) // { coords, times, speeds, confidence, distanceKm }
```

Sparse fixes (one every ~30 s is fine) are snapped to the road network via OSRM `/match` —
chunked with overlap so the public server's ~10-point cap doesn't matter — with timestamps for
better matching, and a time/speed profile rebuilt along arc length. Point `baseUrl` at a
self-hosted OSRM in production. See the `gps-matching` example for the raw-vs-snapped story.

## Performance notes (encoded as defaults)

- Raster + raster-dem share one 16-slot request queue (8 while moving) in MapLibre; far-field
  tiles at high pitch starve last. The LOD cap + the two-tier underlay fix the "empty chunks on
  fast zoom-out" class of bugs.
- DEM `maxzoom: 12` keeps terrain covering cheap; the hillshade uses its own raster-dem instance.
- `fadeDuration: 0`, `maxTileCacheSize: 300`, no style validation, no tile refresh.
- Idle maps cost ~zero repaints: dash/pulse animators gate on recent camera movement and
  `document.hidden`, settling to a static frame.
- Errored tiles are not retried by MapLibre — surface `engine.errors` if you suspect them.

## Licensing

The default satellite imagery (Esri World_Imagery) and the public OSRM demo server are fine for
demos and evaluation, not for production use. Swap in licensed tiles via
`Render({ provider: 'tiles', tiles: '...' })` and a self-hosted OSRM via `matching`'s `baseUrl`.
