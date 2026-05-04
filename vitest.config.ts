import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    /* All e2e tests touch shared resources (Supabase, ElevenLabs, Twilio).
       Force serial execution so we don't ddos any provider with parallel
       traffic from the same suite — multi-account.test.ts handles the
       parallel-stress angle on purpose. */
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 60_000,
    hookTimeout: 60_000,
    include: ["tests/e2e/specs/**/*.test.ts"],
    setupFiles: ["tests/e2e/setup.ts"],
  },
});
