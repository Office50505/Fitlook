import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash]-fitlook2.js',
        chunkFileNames: 'assets/[name]-[hash]-fitlook2.js',
        assetFileNames: 'assets/[name]-[hash]-fitlook2[extname]'
      }
    }
  },
  server: {
    port: 5173,
    watch: {
      ignored: ['**/.venv/**', '**/.venv-rembg/**', '**/.model-cache/**']
    },
    proxy: {
      '/api': 'http://localhost:5050',
      '/uploads': 'http://localhost:5050'
    }
  }
});
