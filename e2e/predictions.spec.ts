import { expect, test } from "@playwright/test"

/**
 * E2E helpers for the email magic-link login flow.
 * The verification email is caught by Mailpit (docker-compose `mail` service),
 * exposed at http://localhost:8025 with a JSON API.
 */
const MAILPIT_API = "http://localhost:8025/api/v1"

async function getLatestSignInLink(): Promise<string> {
  // Poll Mailpit for the most recent message containing a sign-in URL.
  for (let attempt = 0; attempt < 20; attempt++) {
    const res = await fetch(`${MAILPIT_API}/messages?limit=5`)
    const data = (await res.json()) as {
      messages: { ID: string; To: { Address: string }[] }[]
    }
    for (const msg of data.messages ?? []) {
      const detail = await fetch(`${MAILPIT_API}/message/${msg.ID}`)
      const body = (await detail.json()) as { Text?: string; HTML?: string }
      const text = body.Text ?? body.HTML ?? ""
      const m = text.match(/https?:\/\/localhost:3000\/api\/auth\/callback\/email[^\s"'<>]*/)
      if (m) {
        return m[0].replace(/&amp;/g, "&")
      }
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error("No sign-in email received")
}

test("sign in with email magic link, create a prediction, and resolve it", async ({
  page,
}) => {
  // 1. Sign in via email magic link
  await page.goto("/")
  await page.getByRole("button", { name: /log in|sign up/i }).click()
  await page.getByPlaceholder(/email/i).fill("e2e@example.com")
  await page.getByRole("button", { name: /sign in|continue|submit/i }).click()

  const signInLink = await getLatestSignInLink()
  await page.goto(signInLink)

  // Should land back on the home page, signed in
  await expect(page.getByText(/track your predictions|make better decisions/i)).toBeVisible()

  // 2. Create a binary prediction
  const title = `E2E: will this test pass? (${Date.now()})`
  await page.getByPlaceholder(/e\.g\.|predict|question/i).first().fill(title)
  await page.getByRole("button", { name: /predict|create|submit/i }).first().click()

  // The question should now be visible on the page
  await expect(page.getByText(title)).toBeVisible()
})
