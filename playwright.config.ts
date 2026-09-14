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
  // 不再给整套开重试：那会把**新的**不稳定用例也盖成绿色。唯一的已知 flake
  // （HeadlessUI portal 残留）在 `e2e/agent-cli.spec.ts` 里用
  // `test.describe.configure({ retries })` 单独开。
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
    // `on-first-retry` 在 `retries: 0` 下永远不会录制 trace——失败时只剩截图与
    // auto error-context。改为失败即保留，否则失败取证是空的。
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev:e2e",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
