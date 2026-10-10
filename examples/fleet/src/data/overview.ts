import type { Pin, Vehicle, Zone } from '@justanarthur/just-map/modules/data'
import type { Track } from '@justanarthur/just-map'
import { trips } from './trips'

type Coord = [number, number]

const ROUTE_COLORS = ['#38bdf8', '#a78bfa', '#f472b6', '#facc15']

/** recorded routes, each in its own idle color */
export const FLEET_TRACKS: Track[] = trips.map((t, i) => ({ ...t, color: ROUTE_COLORS[i % ROUTE_COLORS.length] }))

const [airport, trnava, vienna] = trips

const heading = ([x0, y0]: Coord, [x1, y1]: Coord) =>
  (Math.atan2((x1 - x0) * Math.cos((y0 * Math.PI) / 180), y1 - y0) * 180) / Math.PI

/** a vehicle `start` of the way along a trip, `step` vertices further per tick while driving */
function onTrip(trip: typeof airport, start: number, tick: number, step: number): Pick<Vehicle, 'coord' | 'heading'> {
  const last = trip.coords.length - 1
  const i = (Math.floor(last * start) + tick * step) % last
  return { coord: trip.coords[i], heading: heading(trip.coords[i], trip.coords[i + 1]) }
}

/** the simulated fleet after `tick` position updates */
export const fleetAt = (tick: number): Vehicle[] => [
  { id: 'V-101', label: airport.plate, status: 'driving', ...onTrip(airport, 0.3, tick, 2) },
  { id: 'V-102', label: trnava.plate, status: 'driving', ...onTrip(trnava, 0.1, tick, 3) },
  { id: 'V-103', label: vienna.plate, status: 'idle', ...onTrip(vienna, 0.25, 0, 0) },
]

const square = ([x, y]: Coord, dx: number, dy: number): Coord[] => [
  [x - dx, y - dy],
  [x + dx, y - dy],
  [x + dx, y + dy],
  [x - dx, y + dy],
]

export const ZONES: Zone[] = [
  { id: 'airport', name: 'Airport depot', ring: square(airport.coords[0], 0.012, 0.007) },
  { id: 'centre', name: 'City centre', ring: square(trnava.coords[0], 0.018, 0.01), color: '#16a34a' },
]

const along = (trip: typeof airport, f: number) => trip.coords[Math.floor((trip.coords.length - 1) * f)]

export const PINS: Pin[] = [
  { id: 'stop-1', kind: 'stop', label: '1', coord: along(trnava, 0.35) },
  { id: 'stop-2', kind: 'stop', label: '2', coord: along(trnava, 0.7) },
  { id: 'harsh-brake', kind: 'warning', coord: along(airport, 0.55) },
  { id: 'speeding', kind: 'critical', coord: along(vienna, 0.6) },
]
