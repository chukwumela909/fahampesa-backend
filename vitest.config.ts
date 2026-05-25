import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    hookTimeout: 900000,
    testTimeout: 60000,
    pool: 'forks',
    fileParallelism: false,
    env: {
      NODE_ENV: 'test'
    }
  }
})
