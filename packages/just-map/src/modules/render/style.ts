import type { SourceSpecification, StyleSpecification } from 'maplibre-gl'
import { module } from '../../core/module'
import type { JustMapEngine } from '../../core/engine'
import { STYLE_PRESETS } from '../../core/style'

/** recolor / restyle / hide base layers by id — the SnazzyMaps-style knob */
export type StyleTweak = {
  match: string | RegExp | ((layerId: string) => boolean)
  paint?: Record<string, unknown>
  layout?: Record<string, unknown>
  visibility?: 'visible' | 'none'
}

export type StyleOptions = {
  /** preset name, style URL, or a full style spec */
  base: keyof typeof STYLE_PRESETS | (string & {}) | StyleSpecification
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
    // base layers = everything present before this module's siblings add theirs
    let baseIds = new Set(map.getStyle().layers.map(l => l.id))

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
        const target =
          typeof next.base === 'string' ? (STYLE_PRESETS as Record<string, string>)[next.base] ?? next.base : next.base
        const prev = map.getStyle()
        const keepLayers = prev.layers.filter(l => !baseIds.has(l.id))

        const keepSources: Record<string, SourceSpecification> = {}
        for (const l of keepLayers) {
          const s = (l as { source?: string }).source
          if (s && prev.sources[s]) keepSources[s] = prev.sources[s]
        }

        map.setStyle(target as string, {
          diff: false,
          // sibling modules' layers and sources survive the base swap
          transformStyle: (_prev, nextSpec) => ({
            ...nextSpec,
            sources: { ...nextSpec.sources, ...keepSources },
            layers: [...nextSpec.layers, ...keepLayers],
          }),
        })

        map.once('styledata', () => {
          const keepIds = new Set(keepLayers.map(l => l.id))
          baseIds = new Set(map.getStyle().layers.filter(l => !keepIds.has(l.id)).map(l => l.id))
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
