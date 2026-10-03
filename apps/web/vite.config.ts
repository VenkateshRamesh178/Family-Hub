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
      // Only the app shell is precached. Google API calls are cross-origin and
      // never cached by the service worker; offline data comes from IndexedDB (Phase 2).
      workbox: {
        navigateFallback: '/index.html',
      },
    }),
  ],
  server: {
    // Must match an "Authorized JavaScript origin" on the OAuth client.
    port: 5173,
    strictPort: true,
  },
});
