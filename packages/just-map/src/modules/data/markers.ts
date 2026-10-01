import maplibregl from 'maplibre-gl'
import { module } from '../../core/module'
import type { JustMapEngine } from '../../core/engine'
import type { Coord } from '../../utils/types'

export type MarkerPoint = {
  coord: Coord
  /** dot color */
  color?: string
  /** native tooltip */
  label?: string
  /** plain-text popup, shown on click */
  popup?: string
}

export type MarkersOptions = {
  points: MarkerPoint[]
  /** refit the camera whenever `points` changes identity */
  fit: false | { padding: number; maxZoom: number }
}

/** imperative handle for `Markers` (`engine.module<MarkersHandle>('Markers')`) */
export type MarkersHandle = {
  setPoints(points: MarkerPoint[]): void
}

type State = MarkersHandle & {
  options: MarkersOptions
  markers: maplibregl.Marker[]
  render(): void
}

const DOT = 12

// plain-text popups only — setDOMContent(textContent) keeps marker data out of the HTML stream
const popup = (text: string) => {
  const el = document.createElement('div')
  el.textContent = text
  return new maplibregl.Popup({ offset: DOT + 4 }).setDOMContent(el)
}

function dot(point: MarkerPoint) {
  const el = document.createElement('div')
  el.style.width = el.style.height = `${DOT}px`
  el.style.borderRadius = '50%'
  el.style.background = point.color ?? '#2563eb'
  el.style.border = '2px solid #0f172a'
  el.style.boxSizing = 'border-box'
  el.style.cursor = 'pointer'
  if (point.label) el.title = point.label
  return el
}

/** A handful of DOM markers with dots and optional popups — vehicle positions, points of interest. */
export const Markers = module<MarkersOptions>({
  name: 'Markers',
  defaults: { points: [], fit: false },

  create(engine: JustMapEngine, options: MarkersOptions) {
    const map = engine.map

    const state: State = {
      options,
      markers: [],
      setPoints(points) {
        state.options = { ...state.options, points }
        state.render()
      },
      render() {
        for (const m of state.markers) m.remove()
        const { points, fit } = state.options
        state.markers = points.map(p => {
          const marker = new maplibregl.Marker({ element: dot(p) }).setLngLat(p.coord).addTo(map)
          if (p.popup) marker.setPopup(popup(p.popup))
          return marker
        })
        if (!fit || state.markers.length === 0) return
        if (state.markers.length === 1) {
          map.jumpTo({ center: points[0].coord, zoom: fit.maxZoom })
        } else {
          const bounds = new maplibregl.LngLatBounds()
          for (const p of points) bounds.extend(p.coord)
          map.fitBounds(bounds, { padding: fit.padding, maxZoom: fit.maxZoom })
        }
      },
    }

    state.render()
    return state
  },

  update(state: State, options: MarkersOptions) {
    const pointsChanged = options.points !== state.options.points
    state.options = options
    if (pointsChanged) state.render()
  },

  destroy(state: State) {
    for (const m of state.markers) m.remove()
  },
})
