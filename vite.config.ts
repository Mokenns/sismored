import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/api/csn': {
        target: 'https://evtdb.csn.uchile.cl',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/csn/, '')
      }
    }
  }
});
