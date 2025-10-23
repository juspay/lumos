import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        'mock-server/',
        '**/*.d.ts',
        '**/*.config.*',
        'dist/',
        'scripts/',
      ],
      thresholds: {
        global: {
          branches: 90,
          functions: 90,
          lines: 90,
          statements: 90,
        },
      },
    },
    // Mock configuration
    deps: {
      inline: ['better-sqlite3'], // Inline dependencies for mocking
    },
    // Test timeout
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@/cli': path.resolve(__dirname, 'src/cli'),
      '@/core': path.resolve(__dirname, 'src/core'),
      '@/ai': path.resolve(__dirname, 'src/ai'),
      '@/playwright': path.resolve(__dirname, 'src/playwright'),
      '@/config': path.resolve(__dirname, 'src/config'),
      '@/utils': path.resolve(__dirname, 'src/utils'),
      '@/types': path.resolve(__dirname, 'src/types'),
    },
  },
});
