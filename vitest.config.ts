import { defineConfig } from 'vitest/config';

// Public suite: what the migration agent runs. Builder-only suites live in vitest.private.config.ts.
export default defineConfig({
  test: {
    include: ['features/**/*.test.ts', 'harness/checks/**/*.test.ts', 'harness/lib/**/*.test.ts', 'platform/**/*.test.ts', 'scripts/**/*.test.ts'],
    fileParallelism: false,
  },
});
