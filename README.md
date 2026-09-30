# just-map

A modular 3D map library on MapLibre GL JS — Swiper-style composition of domain modules
(render, terrain, data, animation, navigation), React-first with a vanilla escape hatch.
Extracted from the [maplibre-trips-demo](https://github.com/utegsk) spike with every default
battle-tested there.

```
packages/just-map     the library (see its README for the full API)
examples/basic        smallest possible map — the quick start, runnable
examples/playground   kitchen sink: every module, toggle/slider per option
examples/gps-matching raw GPS breadcrumbs vs road-snapped routes (OSRM /match)
examples/outdoor      terrain-first: globe, big exaggeration, mountain track
examples/fleet        real-time + history vehicle tracking in one app
```

```sh
bun install
bun run build       # builds packages/just-map (tsup, ESM + d.ts)
bun run test        # bun:test unit tests
bun run typecheck

cd examples/basic && bun dev   # each example is a standalone Vite app
```
