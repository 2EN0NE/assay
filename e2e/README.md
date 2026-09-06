# E2E Tests

End-to-end tests using Playwright, covering the core flow: sign in → create a prediction.

## Prerequisites

```bash
# 1. Start the database and local mail catcher (Mailpit)
docker compose up -d db mail

# 2. Configure the environment
cp .env.example .env
# Edit .env: DATABASE_URL / DATABASE_DIRECT_URL point to localhost:5432

# 3. Install the Playwright browser (needs network access)
npx playwright install chromium
```

## Run

```bash
npx playwright test
```

The `webServer` in `playwright.config.ts` starts the Next.js dev server
automatically (reusing an existing server if one is running).

## How the magic-link login works in tests

The app signs in via NextAuth's Email provider. The verification email is
caught by [Mailpit](https://mailpit.axllent.org/) (the `mail` compose service,
SMTP on 1025, web/API on 8025). The test polls `http://localhost:8025/api/v1`
for the latest sign-in email and follows the magic link.

## Notes

- If the browser install fails due to network restrictions, run
  `npx playwright install chromium` on a machine with network access first.
- Unit tests (jest) run separately via `npm test` and do not require a database.
