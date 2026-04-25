import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    allowedHosts: ['aja-spacious-brittaney.ngrok-free.dev'],
    proxy: {
      // Forward backend calls to the FastAPI server so the frontend can use
      // same-origin paths (/api/..., /health) and avoid CORS in dev.
      '/api': 'http://localhost:8000',
      '/generated': 'http://localhost:8000',
      '/health': 'http://localhost:8000',
    },
  },
})
