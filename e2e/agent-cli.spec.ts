import { expect, test } from "@playwright/test"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

const MAILPIT_API = "http://localhost:8025/api/v1"

/**
 * 真实场景 e2e：**agent 经 CLI 写入 → 人在 Web 上看到 → 人背书/确认**。
 *
 * 这是本系统唯一值得保护的端到端路径。两层用意：
 * 1. CLI 不依赖 Next.js 服务即可写库（ADR-0015）——所以这里先跑 CLI，再开页面。
 * 2. 人工 UI 是最高权威的输入源（ADR-0007）——agent 写下的东西必须能在界面上被
 *    看见、被背书、被确认，否则"未背书不进校准"只是一句无法履行的口号。
 */

async function getLatestSignInLink(email: string): Promise<string> {
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
      const match = text.match(
        /https?:\/\/localhost:3000\/api\/auth\/callback\/email[^\s"'<>]*/,
      )
      if (match) return match[0].replace(/&amp;/g, "&")
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error("No sign-in email received")
}

async function signIn(page: import("@playwright/test").Page, email: string) {
  await page.goto("/")
  await page.getByRole("button", { name: /log in|sign up/i }).click()
  await page.getByPlaceholder(/email/i).fill(email)
  await page.getByRole("button", { name: /sign in|continue|submit/i }).click()
  await page.goto(await getLatestSignInLink(email))
  await expect(
    page.getByText(/track your predictions|make better decisions/i),
  ).toBeVisible()
}

/** 以 agent 的身份调用 CLI。owner 邮箱通过环境变量注入（dotenv 不会覆盖已有变量）。 */
async function runCli(
  args: string[],
  ownerEmail: string,
): Promise<{ stdout: string; stderr: string }> {
  // `--silent` 不可省：不加时 npm 会把 " > agent" 之类的横幅写进 stdout，
  // 下游的 JSON.parse 会直接崩掉（ADR-0015 的 stdout 契约）。
  const { stdout, stderr } = await execFileAsync(
    "npm",
    ["run", "--silent", "agent", "--", ...args],
    {
      cwd: process.cwd(),
      env: { ...process.env, FATEBOOK_AGENT_USER_EMAIL: ownerEmail },
      maxBuffer: 10 * 1024 * 1024,
    },
  )
  return { stdout, stderr }
}

// 该预测由 agent **自主取得**（--agent-collected），所以默认未背书。
// 注意：校准图是图片（`/api/calibration_graph`），"背书后计入校准"这条语义由**单测**锁定
// ——`lib/web/resolution.test.ts` 断言未背书样本不进分数集合、也不被 upsert；
// `lib/web/agent_router.test.ts` 断言背书对已结算问题触发重算。这里只断言人在界面上
// 看得见的部分，以及 CLI 视角下的队列变化。
test("agent 自主搜集的预测：Web 可见、标注未背书、背书后移出未背书队列", async ({
  page,
}) => {
  const email = `agent-e2e+${Date.now()}@example.com`

  // 1) 人先登录——CLI 需要一个已存在的 owner 账号
  await signIn(page, email)

  // 2) agent 写入一条自己取得的概率预测（ADR-0008：默认未背书）
  const title = `E2E agent 写入 ${Date.now()}`
  const { stdout: createOut } = await runCli(
    [
      "create-prediction",
      "--title",
      title,
      "--resolve-by",
      "2030-01-01",
      "--criteria",
      "自动化测试判据：出现任一证据即算成",
      "--probability",
      "70%",
      "--agent-collected",
    ],
    email,
  )
  const created = JSON.parse(createOut) as {
    questionId: string
    forecastId: number
    quantified: boolean
  }
  expect(created.quantified).toBe(true)

  // 3) 人在界面上看到它，并被明确告知「Agent 录入」「尚未背书」
  await page.goto(`/q/${created.questionId}`)
  await expect(page.getByText(title)).toBeVisible()
  await expect(page.getByText("Agent 录入")).toBeVisible()
  await expect(page.getByText(/尚未背书/)).toBeVisible()

  // 4) 人背书 —— 此后它才进入校准（ADR-0008）
  await page.getByRole("button", { name: "背书" }).click()
  await expect(page.getByText(/尚未背书/)).toBeHidden()

  // 5) 背书动作确实落库：CLI 视角下不再有未背书样本
  const { stdout: unendorsedOut } = await runCli(["list-unendorsed"], email)
  const unendorsed = JSON.parse(unendorsedOut) as { forecastId: number }[]
  expect(unendorsed.map((f) => f.forecastId)).not.toContain(created.forecastId)
})

test("未量化的命题是合法状态：CLI 允许无概率，Web 显示尚未量化", async ({
  page,
}) => {
  const email = `agent-e2e-unquantified+${Date.now()}@example.com`
  await signIn(page, email)

  const title = `E2E 未量化 ${Date.now()}`
  const { stdout } = await runCli(
    [
      "create-prediction",
      "--title",
      title,
      "--resolve-by",
      "2030-01-01",
      "--criteria",
      "自动化测试判据",
    ],
    email,
  )
  const created = JSON.parse(stdout) as {
    questionId: string
    quantified: boolean
  }
  // ADR-0011：追问的终点可以是「还没想清楚」，此时不写 Forecast
  expect(created.quantified).toBe(false)

  await page.goto(`/q/${created.questionId}`)
  await expect(page.getByText(title)).toBeVisible()
  await expect(page.getByText("Agent 录入")).toBeVisible()
  // ADR-0011：未量化是合法状态且必须**可见**——否则"当初逃避了量化"无从被矫正
  await expect(page.getByText("尚未量化")).toBeVisible()
})

test("缺少来源的公共事实结算会降级为提案，人在 Web 上确认后才真正结算", async ({
  page,
}) => {
  const email = `agent-e2e-settle+${Date.now()}@example.com`
  await signIn(page, email)

  const title = `E2E 结算路径 ${Date.now()}`
  const { stdout } = await runCli(
    [
      "create-prediction",
      "--title",
      title,
      "--resolve-by",
      "2030-01-01",
      "--criteria",
      "自动化测试判据：出现任一证据即算成",
      "--probability",
      "0.5",
    ],
    email,
  )
  const created = JSON.parse(stdout) as { questionId: string }

  // agent 未附来源 → 不得自行结算，只能出提案（ADR-0004）
  const { stdout: settleOut } = await runCli(
    ["settle", "--question-id", created.questionId, "--resolution", "YES"],
    email,
  )
  const settled = JSON.parse(settleOut) as {
    mode: string
    downgraded?: boolean
  }
  expect(settled.mode).toBe("proposed")
  expect(settled.downgraded).toBe(true)

  // 人在界面上看到提案并采纳
  await page.goto(`/q/${created.questionId}`)
  await expect(page.getByText("待确认的结算提案")).toBeVisible()
  await expect(page.getByText(/未附来源/)).toBeVisible()
  await page.getByRole("button", { name: "采纳并结算" }).click()
  await expect(page.getByText("待确认的结算提案")).toBeHidden()
})

test("改动已冻结字段（期限）会留下可见的修订历史（ADR-0012 / issue 05）", async ({
  page,
}) => {
  const email = `agent-e2e-revision+${Date.now()}@example.com`
  await signIn(page, email)

  const title = `E2E 修订留痕 ${Date.now()}`
  const { stdout } = await runCli(
    [
      "create-prediction",
      "--title",
      title,
      "--resolve-by",
      "2030-01-01",
      "--criteria",
      "自动化测试判据：出现任一证据即算成",
      "--probability",
      "0.6",
    ],
    email,
  )
  const created = JSON.parse(stdout) as { questionId: string }

  // 人在 Web 上改期限——已冻结字段可改，但必须给出理由并留痕（ADR-0012）
  await page.goto(`/q/${created.questionId}`)
  await page.getByRole("button", { name: /Resolves/ }).click()
  await page.locator('input[type="date"]').fill("2031-01-01")
  await page
    .getByPlaceholder("Why is the resolution date changing?")
    .fill("延期到明年")
  await page.getByRole("button", { name: "Save" }).click()

  // 复盘视图里能看到这次修订（旧值 → 新值 + 理由）
  await page.getByText(/修订历史/).click()
  await expect(page.getByText(/resolveBy/)).toBeVisible()
  await expect(page.getByText(/延期到明年/)).toBeVisible()

  // CLI 视角同样能看到（ADR-0012 的接口面）
  const { stdout: revisionsOut } = await runCli(
    ["list-revisions", "--question-id", created.questionId],
    email,
  )
  const revisions = JSON.parse(revisionsOut) as {
    field: string
    reason: string | null
  }[]
  expect(revisions.map((r) => r.field)).toContain("resolveBy")
  expect(revisions[0].reason).toBe("延期到明年")
})
