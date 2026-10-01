import maplibregl from 'maplibre-gl'
import { Emitter } from './events'
import type { ModuleSpec } from './module'
import { resolveStyle, type CameraOptions, type SkyPreset, type SkySpecification } from './style'

export type EngineOptions = {
  modules: ModuleSpec<any>[]
  camera?: CameraOptions
  sky?: SkyPreset | SkySpecification | false
}

type EngineEvents = {
  ready: JustMapEngine
  error: unknown
  remove: undefined
}

// containers can sit unrendered for a frame (or in frozen webviews); two rAFs beat one
const layoutReady = (el: HTMLElement) =>
  new Promise<void>(resolve => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }

    requestAnimationFrame(() => requestAnimationFrame(finish))
    setTimeout(finish, 250)
  })

const shallowEqual = (a: Record<string, unknown>, b: Record<string, unknown>) => {
  for (const k in a) if (a[k] !== b[k]) return false
  for (const k in b) if (!(k in a)) return false
  return true
}

export class JustMapEngine {
  map!: maplibregl.Map
  /** resolves when the style has loaded and all modules are created */
  readonly ready: Promise<void>
  /** every maplibre error event, for debugging */
  readonly errors: unknown[] = []

  readonly #order: string[]
  readonly #specs = new Map<string, ModuleSpec<any>>()
  /** modules whose create() has actually run — only these get destroy() */
  readonly #created: string[] = []
  readonly #handles = new Map<string, any>()
  readonly #capabilities = new Set<string>()
  readonly #emitter = new Emitter<EngineEvents>()
  #observer: ResizeObserver | undefined
  #destroyed = false

  constructor(container: string | HTMLElement, options: EngineOptions) {
    for (const spec of options.modules) {
      if (this.#specs.has(spec.def.name)) throw new Error(`just-map: module "${spec.def.name}" installed twice`)
      this.#specs.set(spec.def.name, spec)
    }
    this.#order = options.modules.map(s => s.def.name)

    for (const spec of options.modules)
      for (const req of spec.def.requires ?? [])
        if (!this.#specs.has(req) && !this.#capabilities.has(req))
          throw new Error(`just-map: ${spec.def.name} requires "${req}", which is not installed`)

    for (const spec of options.modules)
      for (const cap of spec.def.provides ?? []) this.#capabilities.add(cap)

    this.ready = this.#init(container, options)
  }

  /** capability check, e.g. `engine.has('3d')` */
  has(capability: string) {
    return this.#capabilities.has(capability)
  }

  /** imperative handle returned by a module's create() */
  module<T = unknown>(name: string): T {
    return this.#handles.get(name) as T
  }

  on(event: 'ready', handler: (engine: JustMapEngine) => void): () => void
  on(event: 'error', handler: (error: unknown) => void): () => void
  on(event: 'remove', handler: () => void): () => void
  on(event: 'ready' | 'error' | 'remove', handler: (payload: any) => void) {
    return this.#emitter.on(event, handler)
  }

  off(event: 'ready' | 'error' | 'remove', handler: (payload: any) => void) {
    this.#emitter.off(event, handler)
  }

  /** apply a module's new options after a re-render; returns false when nothing changed or the module is absent */
  updateModule(spec: ModuleSpec<any>) {
    const installed = this.#specs.get(spec.def.name)
    if (!installed) return false

    const prev = installed.options
    if (shallowEqual(prev as Record<string, unknown>, spec.options)) return false

    installed.options = spec.options
    spec.def.update?.(this.module(spec.def.name), spec.options, prev, this)
    return true
  }

  setCamera(camera: CameraOptions) {
    if (camera.projection) this.map.setProjection({ type: camera.projection })

    const view: maplibregl.JumpToOptions = {}
    if (camera.center) view.center = camera.center
    if (camera.zoom !== undefined) view.zoom = camera.zoom
    if (camera.pitch !== undefined) view.pitch = camera.pitch
    if (camera.bearing !== undefined) view.bearing = camera.bearing
    this.map.jumpTo(view)
  }

  destroy() {
    this.#destroyed = true

    for (const name of [...this.#created].reverse()) {
      const spec = this.#specs.get(name)!
      spec.def.destroy?.(this.module(name), this)
    }

    this.#emitter.emit('remove', undefined)
    this.#emitter.clear()
    this.#observer?.disconnect()
    if (this.map) this.map.remove()
  }

  async #init(container: string | HTMLElement, options: EngineOptions) {
    const el = typeof container === 'string' ? document.querySelector<HTMLElement>(container) : container
    if (!el) throw new Error(`just-map: container "${container}" not found`)

    await layoutReady(el)
    if (this.#destroyed) return

    const { camera = {}, sky = 'day' } = options

    // a Style module provides the base style — it's a foundation, resolved before the map exists
    const styleModule = options.modules.find(m => m.def.name === 'Style')
    const base = styleModule?.options.base

    this.map = new maplibregl.Map({
      container: el,
      style: resolveStyle(base, camera, sky),
      center: camera.center ?? [0, 0],
      zoom: camera.zoom ?? 2,
      pitch: camera.pitch ?? 0,
      bearing: camera.bearing ?? 0,
      maxPitch: camera.maxPitch ?? 80,
      maxTileCacheSize: 300,
      fadeDuration: 0,
      validateStyle: false,
      refreshExpiredTiles: false,
    })
    this.map.on('error', e => {
      this.errors.push(e)
      this.#emitter.emit('error', e)
    })

    this.#observer = new ResizeObserver(() => this.map.resize())
    this.#observer.observe(el)

    await new Promise<void>(resolve => {
      this.map.once('load', resolve)

      // frozen-rAF webviews (occluded panes) defer the load event AND the
      // isStyleLoaded flag indefinitely — but the applied style is queryable
      // without frames: layers present means the style object is live and
      // modules can draw into it
      const poll = window.setInterval(() => {
        if (this.#destroyed || this.map.isStyleLoaded() || this.map.getStyle().layers.length > 0) {
          window.clearInterval(poll)
          resolve()
        }
      }, 250)
    })
    if (this.#destroyed) return
    this.map.resize()

    // URL styles don't carry a projection — apply the camera's after load
    if (camera.projection) this.map.setProjection({ type: camera.projection })

    for (const name of this.#order) {
      const spec = this.#specs.get(name)!
      const handle = spec.def.create?.(this, spec.options)
      if (handle !== undefined) this.#handles.set(name, handle)
      this.#created.push(name)
    }

    for (const spec of this.#specs.values())
      for (const used of spec.def.uses ?? [])
        if (!this.#capabilities.has(used) && !this.#specs.has(used))
          console.warn(`just-map: ${spec.def.name} works best with "${used}" installed — some features stay disabled`)

    this.#emitter.emit('ready', this)
  }
}
