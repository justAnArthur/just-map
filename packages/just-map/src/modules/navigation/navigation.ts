import maplibregl from 'maplibre-gl'
import { module } from '../../core/module'

export type NavigationOptions = {
  /** which NavigationControl buttons to show */
  controls: Array<'compass' | 'zoom'>
  /** the compass needle tilts with the map pitch */
  visualizePitch: boolean
  /** extra classes for the control container — custom styling escape hatch */
  className: string
}

export type NavigationHandle = {
  flyTo(view: { center?: [number, number]; zoom?: number; pitch?: number; bearing?: number; duration?: number }): void
  easeTo(view: Parameters<NavigationHandle['flyTo']>[0]): void
}

type Stored = { control: maplibregl.NavigationControl; el: HTMLElement }

const controls = new WeakMap<NavigationHandle, Stored>()

const build = (options: NavigationOptions) =>
  new maplibregl.NavigationControl({
    visualizePitch: options.visualizePitch,
    showZoom: options.controls.includes('zoom'),
    showCompass: options.controls.includes('compass'),
  })

// maplibre v5 keeps the control root on the private _container; fall back to the first ctrl group
function controlElement(map: maplibregl.Map, control: maplibregl.NavigationControl): HTMLElement {
  return (control as unknown as { _container?: HTMLElement })._container
    ?? map.getContainer().querySelector<HTMLElement>('.maplibregl-ctrl-group')!
}

function setClasses(el: HTMLElement, next: string, prev: string) {
  for (const c of prev.split(/\s+/).filter(Boolean)) el.classList.remove(c)
  for (const c of next.split(/\s+/).filter(Boolean)) el.classList.add(c)
}

/** The maplibre NavigationControl (top-right) plus a flyTo/easeTo camera handle. */
export const Navigation = module<NavigationOptions>({
  name: 'Navigation',
  defaults: { controls: ['compass', 'zoom'], visualizePitch: true, className: '' },

  create(engine, options) {
    const map = engine.map
    const control = build(options)
    map.addControl(control, 'top-right')

    const el = controlElement(map, control)
    setClasses(el, options.className, '')

    const handle: NavigationHandle = {
      flyTo: view => map.flyTo({ ...view, duration: view.duration ?? 3000, essential: true }),
      easeTo: view => map.easeTo(view),
    }
    controls.set(handle, { control, el })
    return handle
  },

  update(handle, options, prev, engine) {
    const stored = controls.get(handle)!
    setClasses(stored.el, options.className, prev.className)

    const same =
      options.visualizePitch === prev.visualizePitch &&
      prev.controls.length === options.controls.length &&
      prev.controls.every(c => options.controls.includes(c))

    if (same) return

    const map = engine.map
    map.removeControl(stored.control)
    const control = build(options)
    map.addControl(control, 'top-right')
    stored.control = control
    stored.el = controlElement(map, control)
    setClasses(stored.el, options.className, '')
  },

  destroy(handle, engine) {
    engine.map.removeControl(controls.get(handle)!.control)
  },
})
