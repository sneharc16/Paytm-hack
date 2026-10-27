import { defineConfig } from "@playwright/test";

// Runs against a production build: pnpm build && pnpm e2e
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  use: { baseURL: "http://localhost:3100", channel: "chrome", viewport: { width: 1440, height: 900 } },
  webServer: { command: "pnpm start -p 3100", url: "http://localhost:3100", reuseExistingServer: true, timeout: 60_000 },
});
