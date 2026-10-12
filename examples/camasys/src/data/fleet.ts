import type { Car, CarKind } from '@justanarthur/just-map/modules/models'
import { trips, type TripData } from './trips'

type Coord = [number, number]

export type FleetVehicle = {
  id: string
  plate: string
  model: string
  kind: CarKind
  driver: string
  /** paint; omitted = default pearl white */
  color?: string
  trip: TripData
  /** where along the trip (0..1) the simulation starts */
  phase: number
  /** parked vehicles stay at `phase` */
  parked?: boolean
}

const byId = new Map(trips.map(t => [t.id, t]))
const trip = (id: string) => byId.get(id)!

// phases put every vehicle in central Bratislava when the demo opens
export const FLEET: FleetVehicle[] = [
  { id: 'V-101', plate: 'BA 392 DP', model: 'Sedan', kind: 'sedan', driver: 'M. Kováč', trip: trip('TR-2411'), phase: 0.878 },
  { id: 'V-102', plate: 'BA 711 KE', model: 'SUV', kind: 'suv', driver: 'J. Horváth', trip: trip('TR-2412'), phase: 0.045 },
  { id: 'V-103', plate: 'TT 509 AC', model: 'Van', kind: 'van', driver: 'P. Novák', trip: trip('TR-2413'), phase: 0.058 },
  { id: 'V-104', plate: 'BA 525 MK', model: 'Pickup', kind: 'truck', driver: 'L. Varga', color: '#b9bec5', trip: trip('TR-2414'), phase: 0.0002 },
  { id: 'V-105', plate: 'BA 118 ZX', model: 'Sedan', kind: 'sedan', driver: 'E. Tóthová', color: '#2b3036', trip: trip('TR-2411'), phase: 0.94 },
  { id: 'V-106', plate: 'BA 640 EV', model: 'Van', kind: 'van', driver: '—', trip: trip('TR-2411'), phase: 0.99, parked: true },
]

/** time index into a trip: the segment containing `t` and how far along it */
function locate(trip: TripData, t: number) {
  const { times } = trip
  let lo = 0
  let hi = times.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (times[mid] <= t) lo = mid
    else hi = mid
  }
  const u = Math.min(1, Math.max(0, (t - times[lo]) / (times[hi] - times[lo] || 1)))
  return { i: lo, u }
}

function positionAt(trip: TripData, t: number): Coord {
  const { i, u } = locate(trip, t)
  const a = trip.coords[i]
  const b = trip.coords[Math.min(i + 1, trip.coords.length - 1)]
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]
}

const bearing = ([x0, y0]: Coord, [x1, y1]: Coord) =>
  (Math.atan2((x1 - x0) * Math.cos((y0 * Math.PI) / 180), y1 - y0) * 180) / Math.PI

export type VehicleState = {
  vehicle: FleetVehicle
  car: Car
  speed: number
  /** 0..1 along the trip */
  progress: number
  status: 'driving' | 'idle' | 'stopped'
}

/** the whole fleet `seconds` into the (looping) simulation */
export function fleetAt(seconds: number): VehicleState[] {
  return FLEET.map(vehicle => {
    const { trip } = vehicle
    const t = (vehicle.phase * trip.durationSec + (vehicle.parked ? 0 : seconds)) % trip.durationSec
    const coord = positionAt(trip, t)
    // heading from a short look-around window keeps corners smooth
    const { i, u } = locate(trip, t)
    const before = positionAt(trip, Math.max(0, t - 3))
    const after = positionAt(trip, Math.min(trip.durationSec, t + 3))
    const moving = before[0] !== after[0] || before[1] !== after[1]
    const heading = moving ? bearing(before, after) : bearing(trip.coords[i], trip.coords[Math.min(i + 1, trip.coords.length - 1)])
    const speed = vehicle.parked ? 0 : trip.speeds[i] + (trip.speeds[Math.min(i + 1, trip.speeds.length - 1)] - trip.speeds[i]) * u
    const status = vehicle.parked ? 'stopped' : speed < 4 ? 'idle' : 'driving'

    return {
      vehicle,
      speed,
      progress: t / trip.durationSec,
      status,
      car: {
        id: vehicle.id,
        coord,
        heading: Number.isFinite(heading) ? heading : 0,
        kind: vehicle.kind,
        color: vehicle.color,
        status,
        label: vehicle.plate,
      },
    }
  })
}
