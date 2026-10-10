import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_'],
  plugins: [react()],
  server: {
    port: 1430,
    strictPort: true,
  },
  test: {
    // No test in src/ renders a component or touches a DOM API, so the default environment is node:
    // jsdom booted 16 times cost ~405s against ~4.7s of actual assertions. A DOM test opts in per file
    // with a leading `// @vitest-environment jsdom` docblock.
    environment: 'node',
    // setupFiles is deliberately not wired: src/test/setup.ts loads @testing-library/jest-dom, no test
    // uses a single one of its matchers, and importing it per file cost 62s. Re-point it at that file
    // the first time a real DOM test lands.
    pool: 'forks',
    // Without this cap vitest forks one worker-per-logical-CPU (12 here), and booting 12 module graphs
    // at once is what pushes the machine into memory compression and wedges the UI.
    poolOptions: {
      forks: {
        maxForks: 2,
        minForks: 1,
      },
    },
  },
})
