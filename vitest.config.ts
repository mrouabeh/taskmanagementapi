import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        // Runs once before each test file: opens Redis, closes it and the DB pool after.
        setupFiles: ['./src/test/setup.ts'],
        // Our tests share one real database, so don't run files in parallel against it.
        fileParallelism: false,
    },
})
