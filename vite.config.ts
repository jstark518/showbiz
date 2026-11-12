import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API_TARGET = process.env.VITE_API_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    // BrightSign players ship an embedded Chromium that trails the desktop by
    // a long way, and firmware updates on a wall-mounted sign are rare. Lower
    // this further if you are targeting older OS 8 hardware.
    target: 'chrome79',
    rollupOptions: {
      input: {
        // index.html is the control panel: the panel is the root, and a sign is
        // a URL you generate from it.
        admin: path.resolve(import.meta.dirname, 'web/index.html'),
        sign: path.resolve(import.meta.dirname, 'web/sign.html'),
        // Framed by the panel to preview a slide. Separate from `sign` so the
        // player never downloads panel tooling, even though it imports the
        // sign's own renderers and stylesheet — see web/preview.html.
        preview: path.resolve(import.meta.dirname, 'web/preview.html'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/media': { target: API_TARGET, changeOrigin: true },
    },
  },
});
