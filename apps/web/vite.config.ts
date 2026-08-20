import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig({
  plugins: [
    react(),
    // `injectManifest`, NOT `generateSW`. src/sw.js is a hand-written
    // worker carrying the Web Push, notificationclick and deep-link
    // logic this app cannot express through Workbox's generated
    // strategies (see that file's header). generateSW would overwrite it.
    // All this strategy does is compile that file and substitute
    // `self.__WB_MANIFEST` with the content-hashed build asset list.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      // The worker is registered by hand in src/main.tsx — see the
      // comment there for why registration happens at boot rather than
      // on push opt-in. An injected registration would be a second,
      // competing one.
      injectRegister: null,
      // public/manifest.webmanifest is the source of truth and is already
      // linked from index.html; letting the plugin emit a second manifest
      // would leave two files disagreeing about name, icons and colors.
      manifest: false,
      injectManifest: {
        // The app shell only. Precaching the ONNX model artifact
        // (packages/ml-inference) is deliberately excluded — it is a
        // multi-megabyte download that PROJECT_PLAN §13.10 gates behind
        // its own opt-in slice, not something to pull down on every
        // first visit over a mobile connection in Bangladesh.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
        globIgnores: ['**/bundle-report.html', '**/*.onnx', '**/offline.html'],
      },
      devOptions: {
        // Without this the worker is not served by `vite dev` at all, and
        // local push/install testing silently has nothing to register.
        enabled: true,
        type: 'classic',
      },
    }),
    visualizer({
      filename: 'dist/bundle-report.html',
      gzipSize: true,
      brotliSize: true,
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // scripts/check-bundle-budget.mjs reads this to measure only the
    // eagerly-loaded shell (the entry chunk and its static imports),
    // never the lazy route chunks a browser only fetches on navigation.
    manifest: true,
  },
});
