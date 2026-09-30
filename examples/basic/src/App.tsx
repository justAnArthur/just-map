import type { CameraOptions } from 'just-map'
import { JustMap } from 'just-map/react'
import { Render } from 'just-map/modules/render'
import { Navigation } from 'just-map/modules/navigation'

const modules = [Render(), Navigation()]
const camera: CameraOptions = { center: [20.055, 49.115], zoom: 12.6, pitch: 70, bearing: -32 }

export default function App() {
  return (
    <div className="app">
      <JustMap modules={modules} camera={camera} />
      <div className="card">
        <h1>just-map · basic</h1>
        <p>Render + Navigation — that's the whole app.</p>
      </div>
    </div>
  )
}
