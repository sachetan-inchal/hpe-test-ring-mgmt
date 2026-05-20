import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    allowedHosts: true,
    proxy: {
      '/api': 'http://127.0.0.1:5005',
      '/sim': 'http://127.0.0.1:5001',
      '/chatbot': {
        target: 'http://127.0.0.1:5010',
        rewrite: (path) => path.replace(/^\/chatbot/, '/api'),
      },
    }
  }
})
