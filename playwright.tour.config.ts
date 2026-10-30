import { defineConfig } from "@playwright/test";

// The screenshot tour (tests/tour). Runs against a dev server that is already up: TOUR_URL, or localhost:3001.
export default defineConfig({
  testDir: "tests/tour",
  timeout: 120_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: process.env.TOUR_URL ?? "http://localhost:3001", channel: "chrome", viewport: { width: 1440, height: 900 } },
});
