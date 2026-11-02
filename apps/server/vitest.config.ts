import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Tests run against the shared package's source, so it does not need a build first.
    alias: { '@ai-pm/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The first Fastify boot in a cold worker can exceed the 5 s default on a busy machine.
    testTimeout: 15_000,
  },
});
