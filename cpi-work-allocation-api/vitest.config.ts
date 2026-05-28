import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    // Only run TypeScript tests in src/. Vitest 4 dropped **/dist/** from
    // its default exclude list, so without this it would also pick up any
    // compiled .test.js files in dist/ and race the source tests against
    // their own compiled copies on the same DB rows.
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    // Run test files serially (singleFork) to avoid DB contention.
    // Vitest 4 uses top-level options instead of poolOptions.
    singleFork: true,
    pool: 'forks',
  },
});
