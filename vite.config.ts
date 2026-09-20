import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// base is the GitHub Pages sub-path: https://<user>.github.io/baby-app/
export default defineConfig({
  base: '/baby-app/',
  plugins: [svelte()],
  test: { environment: 'node', include: ['src/**/*.test.ts'] }
});
