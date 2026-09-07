import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const apiTarget = (env.VITE_DEV_PROXY_TARGET || env.VITE_API_BASE_URL || 'http://localhost:5050')
    .replace(/\/$/, '')
    .replace(/\/api$/, '');
  const apiProxy = {
    target: apiTarget,
    changeOrigin: true
  };

  return {
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          entryFileNames: 'assets/[name]-[hash]-lookmefy.js',
          chunkFileNames: 'assets/[name]-[hash]-lookmefy.js',
          assetFileNames: 'assets/[name]-[hash]-lookmefy[extname]',
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'react-vendor';
            return 'vendor';
          }
        }
      }
    },
    server: {
      port: 5173,
      watch: {
        ignored: ['**/.venv/**', '**/.venv-rembg/**', '**/.model-cache/**']
      },
      proxy: {
        '/api': apiProxy,
        '/uploads': apiProxy
      }
    }
  };
});
