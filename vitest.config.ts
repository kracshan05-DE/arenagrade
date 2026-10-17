import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))
// 'server-only' throws outside the Next.js server bundle; tests run server code directly.
const alias = { '@': root, 'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)) }

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'db',
          include: ['tests/db/**/*.test.ts', 'tests/api/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['tests/db/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
})
