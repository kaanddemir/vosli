import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

// Relative base and hash routes let the app run from any static host path.
export default defineConfig({
  base: './',
  // Marks stored dictionary results, which only hold for the build that made them.
  define: { __BUILD_ID__: JSON.stringify(String(Date.now())) },
  // Minifying drops the notices of bundled packages, and their licenses ask that they ship with the code.
  build: { target: 'es2022', license: { fileName: 'third-party-licenses.md' } },
  plugins: [
    preact(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'Vosli',
        short_name: 'Vosli',
        description: 'Almanca kelime çalışma uygulaması',
        lang: 'tr',
        id: './',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        background_color: '#F7F5F1',
        theme_color: '#F7F5F1',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // PDF.js's worker is .mjs and over the 2 MiB default once counted with a margin, and the dictionary's
      // forms file is larger still. PDF import and word checks must work offline.
      workbox: { globPatterns: ['**/*.{js,mjs,css,html,woff2,svg,png,txt}'], maximumFileSizeToCacheInBytes: 6 * 1024 * 1024 },
    }),
  ],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
