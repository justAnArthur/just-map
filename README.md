# @justanarthur/just-map

A modular 3D map library on MapLibre GL JS — Swiper-style composition of domain modules
(render, terrain, data, animation, navigation), React-first with a vanilla escape hatch.
Extracted from the maplibre-trips-demo spike with every default battle-tested there.

**Use it in your app:** `npm install @justanarthur/just-map maplibre-gl react` — see the
[library README](packages/just-map/README.md) for the full API, presets and quick starts.

```
packages/just-map     the library (see its README for the full API)
examples/basic        styling playground: map/hybrid/satellite + base styles + tweaks + 3D
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

cd examples/basic && bun dev   # each example is a standalone Vite app (ports 5191-5195)
```

## Releases

Versioning, npm publishing and GitHub releases run via
[just-github-actions-n-workflows](https://github.com/justAnArthur/just-github-actions-n-workflows)
(`bump-version`, `publish-npm-on-tag`, `release-on-tag`). Conventional commits with the `map`
scope bump the package (`feat(map): …`); pushing a `@justanarthur/just-map@x.y.z` tag
publishes to npm and cuts the release.
