import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.VITE_DEV_PROXY_TARGET || 'http://localhost:5050';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash]-lookmefy.js',
        chunkFileNames: 'assets/[name]-[hash]-lookmefy.js',
        assetFileNames: 'assets/[name]-[hash]-lookmefy[extname]'
      }
    }
  },
  server: {
    port: 5173,
    watch: {
      ignored: ['**/.venv/**', '**/.venv-rembg/**', '**/.model-cache/**']
    },
    proxy: {
      '/api': apiTarget,
      '/uploads': apiTarget
    }
  }
});
