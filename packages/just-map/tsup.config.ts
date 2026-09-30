import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    core: 'src/core/index.ts',
    react: 'src/react/index.tsx',
    'modules/render': 'src/modules/render/index.ts',
    'modules/terrain': 'src/modules/terrain/index.ts',
    'modules/data': 'src/modules/data/index.ts',
    'modules/animation': 'src/modules/animation/index.ts',
    'modules/navigation': 'src/modules/navigation/index.ts',
    presets: 'src/presets/index.ts',
    matching: 'src/matching/index.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  external: ['maplibre-gl', 'react', 'react-dom'],
})
