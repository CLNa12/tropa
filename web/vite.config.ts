import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Во время разработки интерфейс живёт на 5173 и проксирует /api на сервер Tropa (4317),
// чтобы не возиться с CORS. В собранном виде всё отдаёт сам сервер с одного адреса.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4317',
        changeOrigin: false,
        // поток событий не должен буферизоваться прокси
        configure: (proxy) => proxy.on('proxyRes', (res) => res.headers['cache-control'] && delete res.headers['cache-control']),
      },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
