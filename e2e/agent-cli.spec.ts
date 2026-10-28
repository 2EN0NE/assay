import { expect, test } from "@playwright/test"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { API_KEY_LENGTH } from "../lib/api_key"

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
  // 首页有两个匹配 /log in|sign up/i 的按钮（"Log in or sign up" 与 hero 区的
  // "Sign up to predict"），模糊匹配会 strict mode 报错。点名要打开登录表单的那一个。
  await page.getByRole("button", { name: "Log in or sign up" }).click()
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
      // 清空 `ASSAY_AGENT_API_KEY`：否则开发者本机设过这把钥匙时，邮箱路径的
      // 用例会静默走上另一条身份（ADR-0026 的优先级）。用空串而不是 `undefined`：
      // `npm run agent` 还会再 `dotenv -e .env` 一次，**缺失的键会被它从 `.env`
      // 补回来**；空串既拦得住注入（dotenv 不覆盖已存在的键），在 `context.ts`
      // 里又是 falsy（`if (apiKey)` 不进分支），因此回退到邮箱。
      env: {
        ...process.env,
        ASSAY_AGENT_API_KEY: "",
        ASSAY_AGENT_USER_EMAIL: ownerEmail,
      },
      maxBuffer: 10 * 1024 * 1024,
    },
  )
  return { stdout, stderr }
}

type CliFailure = { code: number; stdout: string; stderr: string }

/**
 * 跑一条**应当失败**的命令，把 exit code 与两个流原样带回来。
 *
 * stdout/stderr 的分工与 exit code 是 Agent 判断成败的全部依据（ADR-0015），
 * 所以失败路径必须能被断言，而不是只能被看到。
 */
async function runCliExpectingFailure(
  args: string[],
  ownerEmail: string,
): Promise<CliFailure> {
  try {
    await runCli(args, ownerEmail)
  } catch (error: unknown) {
    const failure = error as Partial<CliFailure>
    return {
      code: failure.code ?? -1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    }
  }
  throw new Error(`期望 CLI 失败，但它成功了：${args.join(" ")}`)
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
  // 用链接而不是文本：同一个 title 也会出现在通知正文里（react-markdown 渲染成
  // <strong>），`getByText` 会同时命中两个元素而触发 strict mode。卡片的标题链接
  // 才是“人在界面上看到它”的那个元素。
  await expect(
    page.getByRole("link", { name: title, exact: true }),
  ).toBeVisible()
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
      // 显式声明来源：e2e 的结果不得取决于跑测试的人是不是 agent（ADR-0024）。
      "--stated-by-owner",
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
  await expect(
    page.getByRole("link", { name: title, exact: true }),
  ).toBeVisible()
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
      "--stated-by-owner",
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
  // 通知正文里也有“但未附来源”的措辞，两个元素会同时命中。提案行用的是带括号的
  // 表达（建议结算为 …（未附来源）），用它来锁定提案面板里的那一行。
  await expect(page.getByText(/（未附来源）/)).toBeVisible()
  await page.getByRole("button", { name: "采纳并结算" }).click()
  await expect(page.getByText("待确认的结算提案")).toBeHidden()
})

// 已知 flake（见 `e2e/README.md`）：HeadlessUI portal 残留。重试只挂在**这一条**上，
// 而不是全局 `retries`——否则新引入的不稳定用例会被重试悄悄盖成绿色。
test.describe("已知 flake：HeadlessUI portal 残留", () => {
  test.describe.configure({ retries: process.env.CI ? 1 : 0 })

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
        "--stated-by-owner",
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
    // 等对话框真的关掉再继续：HeadlessUI 的 portal 残留会拦住下一次点击，
    // 而失败的形态是「超时」，看不出跟对话框有关（e2e/README 记过这条 flake）。
    await expect(
      page.getByPlaceholder("Why is the resolution date changing?"),
    ).toBeHidden()

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
})

test("复盘视图：决策时记录与最终结果并排，且结算后清单锁定（ticket 06）", async ({
  page,
}) => {
  const email = `agent-e2e-decision+${Date.now()}@example.com`
  await signIn(page, email)

  // 1) agent 在决策当时记下决策与清单
  const { stdout: createdOut } = await runCli(
    [
      "create-decision",
      "--statement",
      `E2E 决策 ${Date.now()}`,
      "--reasoning",
      "团队刚融资，值得赌",
    ],
    email,
  )
  const decision = JSON.parse(createdOut) as { id: string }

  await runCli(
    [
      "set-rubric",
      "--decision-id",
      decision.id,
      "--done",
      "alternatives,baseRate",
    ],
    email,
  )

  // 2) 挂一条 Prediction 并结算它
  const { stdout: predOut } = await runCli(
    [
      "create-prediction",
      "--title",
      `E2E 决策命题 ${Date.now()}`,
      "--resolve-by",
      "2030-01-01",
      "--criteria",
      "自动化测试判据：出现任一证据即算成",
      "--stated-by-owner",
      "--probability",
      "0.6",
      "--decision-id",
      decision.id,
    ],
    email,
  )
  const prediction = JSON.parse(predOut) as { questionId: string }

  await runCli(
    [
      "settle",
      "--question-id",
      prediction.questionId,
      "--resolution",
      "YES",
      "--source",
      "https://example.com/evidence",
    ],
    email,
  )

  // 3) 复盘视图：两侧并排可见
  await page.goto(`/decisions/${decision.id}`)
  await expect(page.getByText(/决策清单/)).toBeVisible()
  await expect(page.getByText(/挂着的预测/)).toBeVisible()

  // 4) 结算之后清单已锁定，并说明是哪条预测关上的门
  await expect(page.getByText(/清单已锁定/)).toBeVisible()

  // 5) 锁定不只是界面上写着：服务端真的拒绝写入，且拒绝信息指明是哪条预测
  const lockedWrite = await runCliExpectingFailure(
    ["set-rubric", "--decision-id", decision.id, "--done", "premortem"],
    email,
  )
  expect(lockedWrite.code).toBe(1)
  expect(lockedWrite.stdout).toBe("")
  expect(lockedWrite.stderr).toMatch(/已锁定/)

  // 6) 列表页同时给出质量侧与结果侧（两个数，不是一个）
  await page.goto("/decisions")
  await expect(page.getByText(/清单 2\/5/)).toBeVisible()
  await expect(page.getByText(/已揭晓 1\/1/)).toBeVisible()
})

test("CLI 契约：未知命令非零退出，错误只走 stderr，stdout 保持空（ADR-0015）", async () => {
  // 与所有其他用例不同，这一条验的是**进程级**契约而不是返回值：Agent 是按 exit code
  // 与 stdout/stderr 分工来判断成败的，而这层约定此前没有任何自动化验证。
  const failure = await runCliExpectingFailure(
    ["definitely-not-a-command"],
    "nobody@example.com",
  )

  expect(failure.code).toBe(1)
  // stdout 是数据通道：失败时也不能混入任何非 JSON 内容
  expect(failure.stdout).toBe("")
  expect(failure.stderr).toMatch(/未知命令/)
})

/**
 * `init` 是"没有浏览器也能开始记录"的入口，因此它同时是**自助注册**（ADR-0022）。
 * 两条 ACL 都必须被锁住：护栏（非空库不得静默建号）与"凭据不得进入日志"。
 * 关键在于断言**两个流的分工**——stdout 是对 Agent 的数据通道，stderr 是日志，
 * 而 adr-0022 说得很直接：打印出来的凭据就是身份本身。
 */
test("CLI 自举建号：护栏拒绝静默建号，凭据只走 stdout 且立刻可当身份用（ADR-0021 / 0022）", async () => {
  const label = `e2e-init-${Date.now()}`
  // 自建前置条件（非空库）：否则护栏（count > 0）不触发，这个用例就会依赖
  // "前面的用例刚建过账号"——单跑 `-g 自举建号` 或空库上必然失败。
  await runCli(
    ["init", "--label", `${label}-seed`, "--allow-create-user"],
    "nobody@example.com",
  )

  const refused = await runCliExpectingFailure(
    ["init", "--label", label],
    "nobody@example.com",
  )
  expect(refused.code).toBe(1)
  // 失败时 stdout 依然是空的：数据通道不能混入非 JSON
  expect(refused.stdout).toBe("")
  expect(refused.stderr).toMatch(/拒绝自动建号/)

  // 显式放行才建号
  const { stdout, stderr } = await runCli(
    ["init", "--label", label, "--allow-create-user"],
    "nobody@example.com",
  )
  const created = JSON.parse(stdout) as {
    userId: string
    email: string
    apiKey: string
  }
  expect(created.email).toBe(`${label}@localhost`)
  // 形状只有一个定义处（ADR-0021）：断言读生成侧的常量，不写死数字
  expect(created.apiKey).toHaveLength(API_KEY_LENGTH)

  // ADR-0022：凭据**不得进入日志**。它是身份本身，进了日志等于身份被抄走。
  expect(stderr).not.toContain(created.apiKey)

  // 凭据立刻可用，且优先于遗留的邮箱来源——这里故意把邮箱指向一个不存在的账号，
  // 若实现悄悄回退到邮箱，就会以「找不到邮箱」失败（而不是碰巧通过）。
  const { stdout: whoami } = await runCli(
    ["whoami", "--api-key", created.apiKey],
    "someone-else@example.com",
  )
  expect(JSON.parse(whoami)).toEqual({
    userId: created.userId,
    email: created.email,
    credentialSource: "api-key-flag",
  })

  // 无效钥匙当场失败，且不回退（错误钥匙不能变成另一个人的身份）
  const invalid = await runCliExpectingFailure(
    ["whoami", "--api-key", "definitely-not-a-key"],
    "someone-else@example.com",
  )
  expect(invalid.code).toBe(1)
  expect(invalid.stdout).toBe("")
  expect(invalid.stderr).toMatch(/凭据无效/)
})

/**
 * 复盘视图的"结果侧"（ticket 11 / 12）。
 *
 * 两条语义只能在界面上看见，因此必须在界面上断言：
 * - 逐条 Prediction 的分数（空 ≠ 0 分）——接口侧已有单测，但"人看得到吗"没有；
 * - 清单写在**结果揭晓之后**的披露——这正是 ADR-0020 第六点要防的事后美化。
 */
test("复盘视图：逐条分数在界面上可见，结果揭晓后才写的清单会被披露", async ({
  page,
}) => {
  const email = `agent-e2e-review+${Date.now()}@example.com`
  await signIn(page, email)

  const { stdout: decisionOut } = await runCli(
    ["create-decision", "--statement", `E2E 披露 ${Date.now()}`],
    email,
  )
  const decision = JSON.parse(decisionOut) as { id: string }

  // 先结算一条预测，再补清单，最后才挂上去 —— 这里是"结果揭晓之后记录"的唯一构造方式
  const { stdout: predictionOut } = await runCli(
    [
      "create-prediction",
      "--title",
      `E2E 披露命题 ${Date.now()}`,
      "--resolve-by",
      "2030-01-01",
      "--criteria",
      "自动化测试判据：出现任一证据即算成",
      "--stated-by-owner",
      "--probability",
      "0.6",
    ],
    email,
  )
  const prediction = JSON.parse(predictionOut) as { questionId: string }

  await runCli(
    [
      "settle",
      "--question-id",
      prediction.questionId,
      "--resolution",
      "YES",
      "--source",
      "https://example.com/evidence",
    ],
    email,
  )
  await runCli(
    ["set-rubric", "--decision-id", decision.id, "--done", "alternatives"],
    email,
  )
  await runCli(
    [
      "attach-prediction",
      "--decision-id",
      decision.id,
      "--question-id",
      prediction.questionId,
    ],
    email,
  )

  await page.goto(`/decisions/${decision.id}`)

  // 结果揭晓后才写的清单必须被点名（否则复盘材料能被事后美化）
  await expect(page.getByText(/结果揭晓之后/)).toBeVisible()
  // 逐条分数确实画在界面上（Brier 取三位小数）……
  await expect(page.getByText(/Brier \d+\.\d{3}/)).toBeVisible()
  // ……而且 null 相对分显示为「无相对分」，不是 0（ticket 12 的 AC：空 ≠ 0 分）
  await expect(page.getByText(/无相对分/)).toBeVisible()
})
