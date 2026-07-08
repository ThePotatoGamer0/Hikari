import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // Ensures Discord proxy doesn't block hot-module-reloading
    hmr: {
      clientPort: 443,
    },
  },
})