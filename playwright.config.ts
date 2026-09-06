import { defineConfig, devices } from "@playwright/test"

/**
 * E2E test configuration.
 *
 * Prerequisites (run once):
 *   docker compose up -d db mail   # PostgreSQL + Mailpit (local email catcher)
 *   cp .env.example .env           # then set DATABASE_URL to localhost
 *
 * The webServer below starts the Next.js dev server automatically.
 * Login tests read the magic-link email from Mailpit's API (http://localhost:8025).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
