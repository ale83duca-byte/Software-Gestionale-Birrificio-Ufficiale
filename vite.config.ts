import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: [
        'favicon.ico',
        'logo.svg',
        'apple-touch-icon.png',
        'pwa-192x192.png',
        'pwa-512x512.png',
        'pwa-maskable-512x512.png',
      ],
      manifest: {
        id: '/',
        name: 'Brew Panda - Brewery Management',
        short_name: 'Brew Panda',
        description:
          'Gestionale completo per birrificio artigianale: cotte, cantina, magazzino birre, parco fusti, accise ADM e inventario offline.',
        theme_color: '#2c3e50',
        background_color: '#2c3e50',
        display: 'standalone',
        orientation: 'any',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,json}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
  server: {
    port: 3000,
    host: '0.0.0.0',
    open: false,
  },
  preview: {
    port: 3000,
    host: '0.0.0.0',
    open: false,
  },
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'assets/brewpanda-v207.js',
        chunkFileNames: 'assets/brewpanda-v207-[name].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith('.css')) {
            return 'assets/brewpanda-v207.css';
          }
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
});
