import maplibregl from 'maplibre-gl'
import { module } from '../../core/module'

export type NavigationOptions = {
  /** which NavigationControl buttons to show */
  controls: Array<'compass' | 'zoom'>
  /** the compass needle tilts with the map pitch */
  visualizePitch: boolean
}

export type NavigationHandle = {
  flyTo(view: { center?: [number, number]; zoom?: number; pitch?: number; bearing?: number; duration?: number }): void
  easeTo(view: Parameters<NavigationHandle['flyTo']>[0]): void
}

const controls = new WeakMap<NavigationHandle, maplibregl.NavigationControl>()

const build = (options: NavigationOptions) =>
  new maplibregl.NavigationControl({
    visualizePitch: options.visualizePitch,
    showZoom: options.controls.includes('zoom'),
    showCompass: options.controls.includes('compass'),
  })

/** The maplibre NavigationControl (top-right) plus a flyTo/easeTo camera handle. */
export const Navigation = module<NavigationOptions>({
  name: 'Navigation',
  defaults: { controls: ['compass', 'zoom'], visualizePitch: true },

  create(engine, options) {
    const map = engine.map
    const control = build(options)
    map.addControl(control, 'top-right')

    const handle: NavigationHandle = {
      flyTo: view => map.flyTo({ ...view, duration: view.duration ?? 3000, essential: true }),
      easeTo: view => map.easeTo(view),
    }
    controls.set(handle, control)
    return handle
  },

  update(handle, options, prev, engine) {
    const same =
      options.visualizePitch === prev.visualizePitch &&
      prev.controls.length === options.controls.length &&
      prev.controls.every(c => options.controls.includes(c))
    if (same) return

    const map = engine.map
    map.removeControl(controls.get(handle)!)
    const control = build(options)
    map.addControl(control, 'top-right')
    controls.set(handle, control)
  },

  destroy(handle, engine) {
    engine.map.removeControl(controls.get(handle)!)
  },
})
