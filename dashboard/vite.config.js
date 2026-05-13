import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:5005',
      '/sim': 'http://localhost:5001',
      '/chatbot': {
        target: 'http://localhost:5010',
        rewrite: (path) => path.replace(/^\/chatbot/, '/api'),
      },
    }
  }
})
