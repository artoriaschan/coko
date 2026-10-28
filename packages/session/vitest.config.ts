import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'session',
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
