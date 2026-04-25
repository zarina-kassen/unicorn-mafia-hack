import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Forward backend calls to the FastAPI server so the frontend can use
      // same-origin paths (/api/..., /health) and avoid CORS in dev.
      '/api': 'http://localhost:8000',
      '/health': 'http://localhost:8000',
    },
  },
})
