import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Front roda em 5192 no dev; a API sobe em 5193 e é proxiada em /api.
export default defineConfig({
  plugins: [react()],
  root: 'client',
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: 5192,
    strictPort: true,
    proxy: { '/api': 'http://localhost:5193' },
  },
});
