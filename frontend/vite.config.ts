import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The web app reuses the backend's pure domain logic (service catalogue, triage
// rules, nearest-station ranking, one-time codes, citizen view), so the demo
// engine behaves exactly like the deployed Lambdas.
const core = fileURLToPath(new URL('../backend/src/lib', import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@core': core } },
  server: { fs: { allow: ['..'] } },
})
