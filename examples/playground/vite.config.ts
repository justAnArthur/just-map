import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// resolve @justanarthur/just-map subpaths to package source for instant HMR while developing the lib
const pkg = fileURLToPath(new URL('../../packages/just-map/src', import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@justanarthur\/just-map\/modules\/(\w+)$/, replacement: `${pkg}/modules/$1/index.ts` },
      { find: /^@justanarthur\/just-map\/react$/, replacement: `${pkg}/react/index.tsx` },
      { find: /^@justanarthur\/just-map\/core$/, replacement: `${pkg}/core/index.ts` },
      { find: /^@justanarthur\/just-map\/presets$/, replacement: `${pkg}/presets/index.ts` },
      { find: /^@justanarthur\/just-map\/matching$/, replacement: `${pkg}/matching/index.ts` },
      { find: /^@justanarthur\/just-map$/, replacement: `${pkg}/index.ts` },
    ],
  },
  server: { port: 5192, strictPort: true },
})
