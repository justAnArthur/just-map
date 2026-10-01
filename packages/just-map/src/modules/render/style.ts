import type { SourceSpecification, StyleSpecification } from 'maplibre-gl'
import { module } from '../../core/module'
import type { JustMapEngine } from '../../core/engine'
import { styleUrl, type StyleBase } from '../../core/style'

/** recolor / restyle / hide base layers by id — the SnazzyMaps-style knob */
export type StyleTweak = {
  match: string | RegExp | ((layerId: string) => boolean)
  paint?: Record<string, unknown>
  layout?: Record<string, unknown>
  visibility?: 'visible' | 'none'
}

export type StyleOptions = {
  /** preset name, style URL, or a full style spec */
  base: StyleBase
  tweaks: StyleTweak[]
  /** labels/main-roads/borders over raster imagery, everything else hidden — the Google hybrid look */
  hybrid: boolean
  /** which base layers survive hybrid mode (labels, names, main roads, borders by default) */
  hybridKeep?: RegExp | ((layerId: string) => boolean)
  /** false hides the entire base (pure-satellite mode) */
  visible: boolean
}

export const HYBRID_KEEP = /label|name|^boundary_|^highway_(major|motorway)/

const matches = (match: StyleTweak['match'], id: string) =>
  typeof match === 'function' ? match(id) : typeof match === 'string' ? match === id : match.test(id)

type Handle = {
  opts: StyleOptions
  apply(): void
  swap(next: StyleOptions): void
}

/**
 * Vector base styles (OpenFreeMap presets, any URL, or a custom style spec)
 * with live tweaks and a hybrid-over-imagery mode. Replaces `Render` when
 * used — or pairs with `Render(satellite)` + `hybrid: true` for photos
 * with street labels on top.
 */
export const Style = module<StyleOptions>({
  name: 'Style',
  defaults: { base: 'positron', tweaks: [], hybrid: false, visible: true },

  create(engine: JustMapEngine, options: StyleOptions) {
    const map = engine.map
    // base layers/sources = everything present before this module's siblings add theirs
    let baseIds = new Set(map.getStyle().layers.map(l => l.id))
    let baseSources = new Set(Object.keys(map.getStyle().sources))

    const handle: Handle = {
      opts: options,

      apply() {
        const keep = handle.opts.hybridKeep ?? HYBRID_KEEP
        const keepMatches = (id: string) => (keep instanceof RegExp ? keep.test(id) : keep(id))

        const layers = map.getStyle().layers
        let topRaster: string | undefined
        for (const l of layers) if (l.type === 'raster') topRaster = l.id

        // hybrid layers sit right above the imagery, still below sibling modules' overlays
        let insertBefore: string | undefined
        if (topRaster) {
          const stack = layers.map(l => l.id)
          insertBefore = stack[stack.lastIndexOf(topRaster) + 1]
        }

        for (const l of layers) {
          if (!baseIds.has(l.id)) continue
          const id = l.id

          const visible = !handle.opts.visible
            ? 'none'
            : handle.opts.hybrid && !keepMatches(id)
              ? 'none'
              : 'visible'
          map.setLayoutProperty(id, 'visibility', visible)

          if (handle.opts.hybrid && visible === 'visible' && insertBefore && insertBefore !== id)
            map.moveLayer(id, insertBefore)

          for (const t of handle.opts.tweaks) {
            if (!matches(t.match, id)) continue
            if (t.visibility) map.setLayoutProperty(id, 'visibility', t.visibility)
            for (const [k, v] of Object.entries(t.paint ?? {})) map.setPaintProperty(id, k, v)
            for (const [k, v] of Object.entries(t.layout ?? {})) map.setLayoutProperty(id, k, v)
          }
        }
      },

      swap(next: StyleOptions) {
        const target = typeof next.base === 'string' ? styleUrl(next.base) : next.base
        const prev = map.getStyle()
        const keepLayers = prev.layers.filter(l => !baseIds.has(l.id))

        // keep every module-owned source — including ones no layer references
        // (a terrain DEM is referenced only by setTerrain, not by any layer)
        const keepSources: Record<string, SourceSpecification> = {}
        for (const [id, s] of Object.entries(prev.sources))
          if (!baseSources.has(id)) keepSources[id] = s

        map.setStyle(target as string, {
          diff: false,
          transformStyle: (_prev, nextSpec) => {
            const merged: StyleSpecification = {
              ...nextSpec,
              sources: { ...nextSpec.sources, ...keepSources },
              layers: [...nextSpec.layers, ...keepLayers],
            }
            if (prev.terrain) merged.terrain = prev.terrain
            if (prev.projection) merged.projection = prev.projection
            if (!merged.sky && prev.sky) merged.sky = prev.sky
            return merged
          },
        })

        map.once('styledata', () => {
          const keepLayerIds = new Set(keepLayers.map(l => l.id))
          const keepSourceIds = new Set(Object.keys(keepSources))
          const style = map.getStyle()
          baseIds = new Set(style.layers.filter(l => !keepLayerIds.has(l.id)).map(l => l.id))
          baseSources = new Set(Object.keys(style.sources).filter(id => !keepSourceIds.has(id)))
          handle.apply()
        })
      },
    }

    handle.apply()
    return handle
  },

  update(handle: Handle, options, prev) {
    handle.opts = options

    if (options.base !== prev.base) handle.swap(options)
    else handle.apply()
  },
})
