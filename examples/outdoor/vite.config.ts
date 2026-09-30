import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// resolve just-map subpaths to package source for instant HMR while developing the lib
const pkg = fileURLToPath(new URL('../../packages/just-map/src', import.meta.url))

export default defineConfig({
  plugins: [react()],
  server: { port: 5194, strictPort: true },
  resolve: {
    alias: [
      { find: /^just-map\/modules\/(\w+)$/, replacement: `${pkg}/modules/$1/index.ts` },
      { find: /^just-map\/react$/, replacement: `${pkg}/react/index.tsx` },
      { find: /^just-map\/core$/, replacement: `${pkg}/core/index.ts` },
      { find: /^just-map\/presets$/, replacement: `${pkg}/presets/index.ts` },
      { find: /^just-map\/matching$/, replacement: `${pkg}/matching/index.ts` },
      { find: /^just-map$/, replacement: `${pkg}/index.ts` },
    ],
  },
})
