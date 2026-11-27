import { defineConfig } from 'vitest/config';

// Builder-only suite. Resets the database. Read access is denied to the migration session.
export default defineConfig({
  test: {
    include: ['legacy/**/*.test.ts', 'harness/seeded/**/*.test.ts', 'audit/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
