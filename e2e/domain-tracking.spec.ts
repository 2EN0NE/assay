import { expect, test } from "@playwright/test"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import prisma from "../lib/prisma"

const execFileAsync = promisify(execFile)

/**
 * 领域与悬空回路的**链路级**验证（ADR-0030 §三 / ADR-0031 §五）。
 *
 * 为什么必须跨层跑一遍：这两条链路的每一环都有单测（`decision_router.test.ts` 断言
 * `connect` 调用、`agent_router.test.ts` 断言 `rescoreResolvedQuestion` 被调用、
 * `domain_stats.test.ts` 钉住统计核心），但"**调用确实发生了**"与"**数据库里真的变了**"
 * 是两件事。中间任何一环断了——写时复制写到了别的行上、重算跑完但分数没落库、
 * 读数把悬空样本算进了判据——单测全是绿的。
 *
 * 观测点用的是 CLI 的读数（`domain-report` 的 n/pending），因为那正是用户在页面上
 * 会看到的同一个过程；夹具用 prisma 直接造（"他人确认的结算"在 CLI 上没有命令能产生，
 * 而它正是悬空的成因）。
 *
 * 身份不经过浏览器：CLI 用邮箱解析已存在的 owner（`FATEBOOK_AGENT_USER_EMAIL`），
 * 所以这两条链路不需要 dev server，也不需要 Playwright 的登录流程。
 */

async function runCli(args: string[], ownerEmail: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "npm",
    ["run", "--silent", "agent", "--", ...args],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        // 空串拦住 `.env` 里的钥匙（dotenv 不覆盖已存在的键），让身份走邮箱那条路
        FATEBOOK_AGENT_API_KEY: "",
        FATEBOOK_AGENT_USER_EMAIL: ownerEmail,
      },
      maxBuffer: 10 * 1024 * 1024,
    },
  )
  return stdout
}

test("挂接预测时把决策的领域写时复制到预测上，读数认得它（ADR-0030 §三）", async () => {
  const suffix = Date.now()
  const domain = `投资/e2e-${suffix}`
  const email = `e2e-domain+${suffix}@example.com`
  const user = await prisma.user.create({ data: { email } })

  try {
    // 造词只有一条路（§七）：未知领域不会被写入路径顺手创建
    await runCli(["add-domain", "--name", domain], email)
    const decision = JSON.parse(
      await runCli(
        [
          "create-decision",
          "--statement",
          `E2E 决策 ${suffix}`,
          "--tags",
          domain,
        ],
        email,
      ),
    ) as { id: string }

    const prediction = JSON.parse(
      await runCli(
        [
          "create-prediction",
          "--title",
          `E2E 领域预测 ${suffix}`,
          "--resolve-by",
          "2030-01-01",
          "--criteria",
          "自动化测试判据：出现任一证据即算成",
          "--probability",
          "60%",
          "--stated-by-owner",
          "--decision-id",
          decision.id,
        ],
        email,
      ),
    ) as { questionId: string }

    // 写时复制落在**库**上（不是只在返回值里）
    const question = await prisma.question.findUnique({
      where: { id: prediction.questionId },
      include: { tags: true },
    })
    expect(question?.decisionId).toBe(decision.id)
    expect(question?.tags.map((tag) => tag.name)).toContain(domain)
    // 领域归属在用户身上——读数按 (tag.userId, forecast.userId) 过滤，缺一不可
    expect(question?.tags.map((tag) => tag.userId)).toContain(user.id)

    // 读数认得这个领域；还没结算 ⇒ 没有样本可计（但领域本身存在）
    const report = JSON.parse(
      await runCli(["domain-report", "--prefix", domain], email),
    ) as { domain: string; n: number; pending: number }
    expect(report.domain).toBe(domain)
    expect(report.n).toBe(0)
    expect(report.pending).toBe(0)
  } finally {
    await prisma.user.delete({ where: { id: user.id } })
  }
})

test("悬空样本经补录来源后计入：读数与分数一起变（ADR-0031 §五/§六）", async () => {
  const suffix = Date.now()
  const domain = `投资/e2e-dangling-${suffix}`
  const authorEmail = `e2e-dangling-a+${suffix}@example.com`
  const otherEmail = `e2e-dangling-b+${suffix}@example.com`
  const author = await prisma.user.create({ data: { email: authorEmail } })
  const other = await prisma.user.create({ data: { email: otherEmail } })

  try {
    // 夹具：已结算、**无**可核查来源、由**他人**确认 ⇒ 作者的样本悬空（§六）
    const tag = await prisma.tag.create({
      data: {
        name: domain,
        nameNormalized: domain.toLowerCase(),
        userId: author.id,
      },
    })
    const question = await prisma.question.create({
      data: {
        userId: author.id,
        title: `E2E 悬空样本 ${suffix}`,
        // 时序必须物理上成立：createdAt < resolveBy < resolvedAt。
        // `createdAt` 不给会默认成“现在”，于是 resolvedAt 落在它之前，
        // `relativeBrierScoring` 的时间区间循环一次都不跑，分数集就是空的
        // ——那时本用例会以“重算没写分”的形式变红，而根因是夹具而不是产品。
        createdAt: new Date("2024-12-01T00:00:00Z"),
        resolveBy: new Date("2025-01-01T00:00:00Z"),
        resolved: true,
        resolution: "YES",
        resolvedAt: new Date("2025-02-01T00:00:00Z"),
        resolutionSource: null,
        // 确认者不是作者 ⇒ 无来源时作者的样本不进计量；确认者自己的仍然计入
        confirmedByUserId: other.id,
        tags: { connect: { id: tag.id } },
        forecasts: {
          create: [
            {
              userId: author.id,
              forecast: 0.6,
              endorsed: true,
              // 预测必须落在结算之前，否则它不进任何时间区间
              createdAt: new Date("2024-12-15T00:00:00Z"),
              endorsedAt: new Date("2024-12-15T00:00:00Z"),
            },
            {
              userId: other.id,
              forecast: 0.7,
              endorsed: true,
              createdAt: new Date("2024-12-16T00:00:00Z"),
              endorsedAt: new Date("2024-12-16T00:00:00Z"),
            },
          ],
        },
      },
    })

    // ① 悬空：作者视角进分母、不进判据（这就是"n 与 pending 必须分开报"要能看见的事）
    const dangling = JSON.parse(
      await runCli(["domain-report", "--prefix", domain], authorEmail),
    ) as { n: number; pending: number }
    expect(dangling.n).toBe(0)
    expect(dangling.pending).toBe(1)
    // 悬空还没有分数落库
    expect(
      await prisma.questionScore.count({ where: { questionId: question.id } }),
    ).toBe(0)

    // ② 补来源：唯一的出口，且必须是**被影响的当事方**才能做（作者押过注）
    const result = JSON.parse(
      await runCli(
        [
          "record-resolution-source",
          "--question-id",
          question.id,
          "--source",
          "https://data.example.org/cpi/2026-03",
        ],
        authorEmail,
      ),
    ) as { rewritten: boolean }
    expect(result.rewritten).toBe(false)

    // ③ 读数跟着变：§五 承诺的"补录后全部计入"必须落在判据上，而不只是列上
    const effective = JSON.parse(
      await runCli(["domain-report", "--prefix", domain], authorEmail),
    ) as { n: number; pending: number }
    expect(effective.n).toBe(1)
    expect(effective.pending).toBe(0)

    // ④ 而且分数真的补上了（重算不是一句注释）
    const settledUserIds = (
      await prisma.questionScore.findMany({
        where: { questionId: question.id },
        select: { userId: true },
      })
    )
      .map((row) => row.userId)
      .sort()
    expect(settledUserIds).toEqual([author.id, other.id].sort())
  } finally {
    await prisma.user.delete({ where: { id: author.id } })
    await prisma.user.delete({ where: { id: other.id } })
  }
})

test.afterAll(async () => {
  await prisma.$disconnect()
})
