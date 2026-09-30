import type maplibregl from 'maplibre-gl'
import { module } from '../../core/module'

export type GesturesOptions = {
  /**
   * Cmd/Ctrl+drag rotate & tilt, Google Maps style. The pitch axis needs the
   * '3d' capability (Terrain) — without it the axis is dropped with one dev
   * warning and only the bearing axis works. Proven values: `{ speed: 0.3, pitchStep: 0.25 }`.
   */
  rotate3d?: { speed: number; pitchStep: number }
  /** maplibre drag-pan enabled */
  pan: boolean
  /** multiplier on the default scroll-zoom rate (1 = default) */
  zoomSpeed: number
  /** maplibre keyboard shortcuts enabled */
  keyboard: boolean
}

type GesturesHandle = {
  speed: number
  pitchStep: number
  pitchOn: boolean
  pan: boolean
  rotating: boolean
  dragging: boolean
  lastX: number
  lastY: number
  off(): void
}

const ROTATE = { speed: 0.3, pitchStep: 0.25 }

/** maplibre has no scrollZoom.setSpeed(); 1/100 (trackpad) and 1/450 (wheel) are its default rates. */
const setZoomSpeed = (map: maplibregl.Map, multiplier: number) => {
  map.scrollZoom.setZoomRate(multiplier / 100)
  map.scrollZoom.setWheelZoomRate(multiplier / 450)
}

/** Drag-pan, scroll zoom and keyboard toggles, plus Cmd/Ctrl+drag rotate & tilt (tilt needs Terrain). */
export const Gestures = module<GesturesOptions>({
  name: 'Gestures',
  uses: ['3d'],
  defaults: { rotate3d: ROTATE, pan: true, zoomSpeed: 1, keyboard: true },

  create(engine, options) {
    const map = engine.map
    const canvas = map.getCanvas()

    const handle: GesturesHandle = {
      speed: options.rotate3d?.speed ?? ROTATE.speed,
      pitchStep: options.rotate3d?.pitchStep ?? ROTATE.pitchStep,
      pitchOn: !!options.rotate3d && engine.has('3d'),
      pan: options.pan,
      rotating: false,
      dragging: false,
      lastX: 0,
      lastY: 0,
      off: () => {},
    }

    if (options.rotate3d && !engine.has('3d'))
      console.warn('Gestures.rotate3d needs Terrain (3d) — pitch axis disabled')

    const setRotating = (on: boolean) => {
      if (on === handle.rotating) return
      handle.rotating = on
      canvas.style.cursor = on ? 'move' : ''
      if (on) map.dragPan.disable()
      else if (handle.pan) map.dragPan.enable()
    }
    const stop = () => {
      handle.dragging = false
      setRotating(false)
    }
    const modifier = (e: KeyboardEvent) => e.key === 'Meta' || e.key === 'Control'

    const onKeyDown = (e: KeyboardEvent) => {
      if (modifier(e)) setRotating(true)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (modifier(e)) stop()
    }
    const onBlur = () => stop()
    const onMouseDown = (e: MouseEvent) => {
      if (!handle.rotating) return
      handle.dragging = true
      handle.lastX = e.clientX
      handle.lastY = e.clientY
      e.preventDefault()
    }
    const onMouseMove = (e: MouseEvent) => {
      if (!handle.dragging || !(e.metaKey || e.ctrlKey)) return
      const dx = e.clientX - handle.lastX
      const dy = e.clientY - handle.lastY
      handle.lastX = e.clientX
      handle.lastY = e.clientY
      const view: { bearing: number; pitch?: number } = { bearing: map.getBearing() + dx * handle.speed }
      if (handle.pitchOn) view.pitch = Math.min(80, Math.max(0, map.getPitch() - dy * handle.pitchStep))
      map.jumpTo(view)
    }
    const onMouseUp = () => stop()

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    canvas.addEventListener('mousedown', onMouseDown)
    handle.off = () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      canvas.removeEventListener('mousedown', onMouseDown)
    }

    if (!options.pan) map.dragPan.disable()
    setZoomSpeed(map, options.zoomSpeed)
    if (!options.keyboard) map.keyboard.disable()

    return handle
  },

  update(handle, options, prev, engine) {
    const map = engine.map

    if (options.pan !== prev.pan) {
      handle.pan = options.pan
      if (!options.pan) map.dragPan.disable()
      else if (!handle.rotating) map.dragPan.enable()
    }
    if (options.zoomSpeed !== prev.zoomSpeed) setZoomSpeed(map, options.zoomSpeed)
    if (options.keyboard !== prev.keyboard)
      options.keyboard ? map.keyboard.enable() : map.keyboard.disable()

    if (options.rotate3d !== prev.rotate3d) {
      handle.pitchOn = !!options.rotate3d && engine.has('3d')
      if (options.rotate3d) {
        handle.speed = options.rotate3d.speed
        handle.pitchStep = options.rotate3d.pitchStep
      }
    }
  },

  destroy(handle, engine) {
    handle.off()
    engine.map.dragPan.enable()
    engine.map.getCanvas().style.cursor = ''
  },
})
