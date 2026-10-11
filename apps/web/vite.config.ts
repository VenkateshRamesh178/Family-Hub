import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Family Hub',
        short_name: 'Family Hub',
        description: 'Shared lists, documents and more for your family.',
        theme_color: '#0f766e',
        background_color: '#f8fafc',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // Only the app shell is precached; API responses are never cached by the service worker.
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  // The API runs on :8000 (npm run api). Proxying keeps it same-origin, so the
  // HttpOnly session cookie just works and no CORS is needed.
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://localhost:8000' },
  },
  preview: {
    proxy: { '/api': 'http://localhost:8000' },
  },
});
