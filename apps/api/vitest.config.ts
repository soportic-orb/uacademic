import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Integration tests share one MySQL database; running files in parallel
    // would have them fight over the same rows.
    fileParallelism: false,
    testTimeout: 20_000,
  },
})
