import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiTarget = process.env.POVIK_API_PROXY ?? 'http://127.0.0.1:8080';

export default defineConfig({
  plugins: [
    // Must come before the React plugin.
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // 5180 rather than Vite's default 5173, which other local projects tend to use.
    port: 5180,
    strictPort: true,
    // Trailing slashes, so client routes such as /authors aren't sent to the API. Realtime
    // (phase 4) will need `ws: true` on /api/.
    proxy: {
      '/api/': apiTarget,
      '/auth/': apiTarget,
    },
  },
});
