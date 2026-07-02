import { defineConfig } from 'vitest/config';

export default defineConfig({
  cacheDir: '.cache/vitest',
  test: {
    include: ['**/vitest/**/*.{spec,test}.{ts,mts,cts}'],
    exclude: ['**/.cache/', '**/build/', '**/coverage/', '**/dist/', '**/node_modules/', '**/scripts/', '**/temp/'],
    globals: true,
    clearMocks: false,
    restoreMocks: false,
    environment: 'node',
    maxWorkers: '100%',
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage/vitest',
      reporter: ['lcov', 'text', 'json'],
      include: ['**/src/**/*.{ts,mts,cts}'],
      exclude: ['**/.cache/', '**/coverage/', '**/dist/', '**/node_modules/', '**/vitest/**', '**/src/**/*.d.ts'],
    },
  },
});
