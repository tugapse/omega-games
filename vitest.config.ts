import { defineConfig } from 'vitest/config';
import { aliases } from './scripts/engine.mjs';

export default defineConfig({
  resolve: { alias: aliases },
  test: { include: ['src/*/src/**/*.test.ts'], environment: 'node' },
});
