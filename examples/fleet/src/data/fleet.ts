import { gpsTrip } from './gps'
import { trips, type TripData } from './trips'

export type Vehicle = { id: string; plate: string; model: string; tripId: string }

/** the demo fleet: each row assigns one recorded trip to a vehicle */
export const VEHICLES: Vehicle[] = [
  { id: 'V-101', plate: 'BA 392 DP', model: 'Škoda Octavia', tripId: 'TR-2411' },
  { id: 'V-102', plate: 'BA 711 KE', model: 'VW Golf', tripId: 'TR-2412' },
  { id: 'V-103', plate: 'TT 509 AC', model: 'Škoda Superb', tripId: 'TR-2413' },
  { id: 'V-101', plate: 'BA 392 DP', model: 'Škoda Octavia', tripId: 'TR-2414' },
  { id: 'V-105', plate: 'BA 525 MK', model: 'Škoda Fabia', tripId: 'TR-2415' },
]

const byId = new Map<string, TripData>([...trips, gpsTrip].map(t => [t.id, t]))

export type VehicleGroup = { id: string; plate: string; model: string; trips: TripData[] }

export const HISTORY_GROUPS: VehicleGroup[] = VEHICLES.filter(v => v.tripId !== gpsTrip.id).reduce<VehicleGroup[]>(
  (groups, v) => {
    const group = groups.find(g => g.id === v.id)
    if (group) group.trips.push(byId.get(v.tripId)!)
    else groups.push({ id: v.id, plate: v.plate, model: v.model, trips: [byId.get(v.tripId)!] })
    return groups
  },
  [],
)
for (const g of HISTORY_GROUPS) g.trips.sort((a, b) => b.startedLabel.localeCompare(a.startedLabel))

export const LIVE_VEHICLE = VEHICLES.find(v => v.tripId === gpsTrip.id)!
