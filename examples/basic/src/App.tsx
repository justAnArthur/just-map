import type { CameraOptions } from 'just-map'
import { JustMap } from 'just-map/react'
import { presets } from 'just-map/presets'

// the flat preset: OSM streets, mercator, no terrain/sky — the plain Google-Maps-style 2D view
const { modules } = presets.flat()
const camera: CameraOptions = { center: [17.1077, 48.1486], zoom: 12.4, projection: 'mercator', pitch: 0 }

export default function App() {
  return (
    <div className="app">
      <JustMap modules={modules} camera={camera} sky={false} />
      <div className="card">
        <h1>just-map · basic</h1>
        <p>presets.flat() — OSM streets, 2D. That's the whole app.</p>
      </div>
    </div>
  )
}
