import { expect, test } from "@playwright/test"

/**
 * E2E helpers for the email magic-link login flow.
 * The verification email is caught by Mailpit (docker-compose `mail` service),
 * exposed at http://localhost:8025 with a JSON API.
 */
const MAILPIT_API = "http://localhost:8025/api/v1"

async function getLatestSignInLink(email: string): Promise<string> {
  // Poll Mailpit for the most recent message to this address containing a sign-in URL.
  for (let attempt = 0; attempt < 20; attempt++) {
    const res = await fetch(`${MAILPIT_API}/messages?limit=20`)
    const data = (await res.json()) as {
      messages: { ID: string; To: { Address: string }[] }[]
    }
    for (const msg of data.messages ?? []) {
      const toAddresses = (msg.To ?? []).map((t) => t.Address)
      if (!toAddresses.includes(email)) continue
      const detail = await fetch(`${MAILPIT_API}/message/${msg.ID}`)
      const body = (await detail.json()) as { Text?: string; HTML?: string }
      const text = body.Text ?? body.HTML ?? ""
      const m = text.match(
        /https?:\/\/localhost:3000\/api\/auth\/callback\/email[^\s"'<>]*/,
      )
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
  // Use a unique email so each run gets an isolated account (no cross-run dirty data).
  const email = `e2e+${Date.now()}@example.com`

  // 1. Sign in via email magic link
  await page.goto("/")
  // 首页有两个匹配 /log in|sign up/i 的按钮（"Log in or sign up" 与 hero 区的
  // "Sign up to predict"），模糊匹配会 strict mode 报错。点名要打开登录表单的那一个。
  await page.getByRole("button", { name: "Log in or sign up" }).click()
  await page.getByPlaceholder(/email/i).fill(email)
  await page.getByRole("button", { name: /sign in|continue|submit/i }).click()

  const signInLink = await getLatestSignInLink(email)
  await page.goto(signInLink)

  // Should land back on the home page, signed in
  await expect(
    page.getByText(/track your predictions|make better decisions/i),
  ).toBeVisible()

  // 2. Create a binary prediction
  const title = `E2E: will this test pass? (${Date.now()})`
  // 题目输入框：placeholder 是产品文案（“Will I finish my project by Friday?”），
  // 按文案写会随文案漂移。这里是首页表单里的第一个文本框。
  await page.locator("main").getByRole("textbox").first().fill(title)
  await page
    .getByRole("button", { name: /predict|create|submit/i })
    .first()
    .click()

  // The question should now be visible on the page
  await expect(page.getByText(title)).toBeVisible()

  // 3. Open the question and resolve it as YES
  await page.getByRole("link", { name: title }).click()
  await page.waitForURL(/\/q\//)

  // exact 不可省：卡上还有一颗 “Resolves tomorrow”，按子串匹配会同时命中两颗按钮。
  await page.getByRole("button", { name: "Resolve", exact: true }).click()
  // 结算菜单是 HeadlessUI 的 Menu：选项的 role 是 menuitem，不是 button。
  await page.getByRole("menuitem", { name: "Yes", exact: true }).click()

  // 4. The resolution is visible to the user (event log shows "Resolved")
  await expect(page.getByText(/Resolved/).first()).toBeVisible()
})
