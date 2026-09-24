import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // open from a phone in the same Wi-Fi to test touch input
    proxy: {
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
  build: {
    target: 'es2020',
    sourcemap: true,
    // pixi.js alone is ~500 kB minified (~150 kB gzip); that is expected for a WebGL engine
    chunkSizeWarningLimit: 900,
  },
});
