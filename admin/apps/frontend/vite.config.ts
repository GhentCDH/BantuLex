import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  root: 'apps/frontend', base: '/admin/', envDir: '../..', plugins: [vue(), tailwindcss()],
  resolve: { dedupe: ['vue', 'vue-router'] },
  build: { outDir: '../../dist/frontend', emptyOutDir: true },
  server: { host: process.env.HOST || '127.0.0.1', port: 5555, strictPort: true, proxy: { '/api': { target: 'http://127.0.0.1:4444', changeOrigin: true } } }
});
