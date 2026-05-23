import { defineConfig, devices } from "@playwright/test";

/* UI tests run against the LIVE deployed app (what users actually see).
   They create throwaway accounts via the admin API, drive the real browser
   through signup/onboarding/integrations, and clean up after. Serial — they
   touch shared backend state (Twilio pool, ElevenLabs agents). */
export default defineConfig({
  testDir: "./tests/ui",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.UI_BASE_URL || "https://app.pathir.com",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    actionTimeout: 20_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
