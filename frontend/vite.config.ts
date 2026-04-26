import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Set `VITE_TUNNEL=1` when serving through ngrok (or any public URL). The HMR
// WebSocket often cannot be reached reliably through tunnels; when it drops,
// Vite's client calls `location.reload()`, which feels like a random restart.
const tunnelDev =
  process.env.VITE_TUNNEL === '1' || process.env.VITE_TUNNEL === 'true'

const backendTarget = 'http://localhost:8000'

/** Dev proxy: disable socket timeouts so SSE streams are not cut mid-job. */
const backendProxy = {
  target: backendTarget,
  changeOrigin: true,
  timeout: 0,
  proxyTimeout: 0,
} as const

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    allowedHosts: ['.ngrok-free.dev', 'localhost', '127.0.0.1'],
    hmr: tunnelDev
      ? false
      : {
          // Ping interval (misnamed `timeout` in Vite) — keep under typical
          // proxy idle limits when HMR is enabled on localhost.
          timeout: 5000,
        },
    proxy: {
      '/api': { ...backendProxy },
      '/health': { ...backendProxy },
      '/generated': { ...backendProxy },
    },
  },
})
