import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Backend to proxy /api to: local uvicorn on :8000 by default,
// or the docker api container via VITE_API_TARGET=http://127.0.0.1:8001
const apiTarget = process.env.VITE_API_TARGET || 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 8080,
    strictPort: true,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/health': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
});
