import { parseArgs } from "./args"
import { AgentApi, Command, commands } from "./commands"

/**
 * 这些测试锁定"CLI 到过程调用"的翻译层：参数如何解析、非法输入如何被拒。
 * 不碰数据库——真库行为由 e2e 覆盖。
 */

const CALLER_METHODS = [
  "listDue",
  "listOpen",
  "createPrediction",
  "endorse",
  "listUnendorsed",
  "listRevisions",
  "settle",
  "listProposals",
  "decideProposal",
  "listPendingDeliveries",
  "reportDelivery",
] as const

type MockAgent = Record<(typeof CALLER_METHODS)[number], jest.Mock>

function fakeContext(): {
  /** 断言用：保留 jest.Mock 以便检查调用参数 */
  mocks: MockAgent
  /** 传参用：形状与真实 caller 一致 */
  session: { agent: AgentApi; userId: string; email: string }
} {
  const mocks = Object.fromEntries(
    CALLER_METHODS.map((name) => [name, jest.fn().mockResolvedValue(name)]),
  ) as MockAgent

  // SAFETY: mocks 覆盖 CALLER_METHODS 的每一个过程，是被测代码会触达的全部面。
  // 这里只是把 jest.fn 的 `mock` 属性从类型上抹掉，好让被测代码看到真实签名。
  const agent = mocks as unknown as AgentApi

  return {
    mocks,
    session: { agent, userId: "user-1", email: "owner@example.com" },
  }
}

function command(name: string): Command {
  const found = commands.find((candidate) => candidate.name === name)
  if (!found) throw new Error(`missing command ${name}`)
  return found
}

/**
 * `run` 不是 async 函数：参数校验错误会**同步**抛出（fail fast，不碰 I/O）；
 * 只有真正调过程的失败才是 rejection。这里包一层 async，把两者统一成
 * rejection 以便用 rejects 断言。
 */
async function expectRunToThrow(
  cmd: Command,
  args: ReturnType<typeof parseArgs>,
  session: { agent: AgentApi; userId: string; email: string },
  pattern: RegExp,
): Promise<void> {
  await expect(
    Promise.resolve().then(() => cmd.run(args, session)),
  ).rejects.toThrow(pattern)
}

describe("CLI 命令翻译层", () => {
  it("每个命令都有 name / summary / usage，便于 --help 自描述", () => {
    for (const candidate of commands) {
      expect(candidate.name).toMatch(/^[a-z][a-z-]*$/)
      expect(candidate.summary.length).toBeGreaterThan(0)
      expect(candidate.usage.startsWith(candidate.name)).toBe(true)
    }
  })

  it("create-prediction 解析日期、百分比概率，并默认判据类型为公共事实", async () => {
    const { mocks, session } = fakeContext()
    await command("create-prediction").run(
      parseArgs([
        "--title",
        "会在三个月内拿到 offer",
        "--resolve-by",
        "2026-03-01",
        "--criteria",
        "邮件里出现正式 offer 字样",
        "--probability",
        "70%",
      ]),
      session,
    )

    expect(mocks.createPrediction).toHaveBeenCalledTimes(1)
    const input = mocks.createPrediction.mock.calls[0][0]
    expect(input.title).toBe("会在三个月内拿到 offer")
    expect(input.oracleKind).toBe("PUBLIC_FACT")
    expect(input.probability).toBeCloseTo(0.7)
    expect(input.resolveBy).toBeInstanceOf(Date)
  })

  it("create-prediction 省略概率时不传 probability（未量化是合法状态）", async () => {
    const { mocks, session } = fakeContext()
    await command("create-prediction").run(
      parseArgs([
        "--title",
        "还没想清楚要不要接",
        "--resolve-by",
        "2026-03-01",
        "--criteria",
        "我说了算",
      ]),
      session,
    )
    expect(mocks.createPrediction.mock.calls[0][0].probability).toBeUndefined()
  })

  it("create-prediction 拒绝非法的判据类型", async () => {
    const { session } = fakeContext()
    await expectRunToThrow(
      command("create-prediction"),
      parseArgs([
        "--title",
        "x",
        "--resolve-by",
        "2026-03-01",
        "--criteria",
        "y",
        "--oracle-kind",
        "NONSENSE",
      ]),
      session,
      /--oracle-kind/,
    )
  })

  it("endorse 要求至少一个标识符", async () => {
    const { mocks, session } = fakeContext()
    await expectRunToThrow(
      command("endorse"),
      parseArgs([]),
      session,
      /--forecast-id 或 --question-id/,
    )

    await command("endorse").run(parseArgs(["--question-id", "q1"]), session)
    expect(mocks.endorse).toHaveBeenCalledWith({
      forecastId: undefined,
      questionId: "q1",
    })
  })

  it("settle 拒绝非法的结算结论", async () => {
    const { session } = fakeContext()
    await expectRunToThrow(
      command("settle"),
      parseArgs(["--question-id", "q1", "--resolution", "MAYBE"]),
      session,
      /--resolution/,
    )
  })

  it("settle 把来源传给过程（无来源时由过程降级为提案）", async () => {
    const { mocks, session } = fakeContext()
    await command("settle").run(
      parseArgs([
        "--question-id",
        "q1",
        "--resolution",
        "YES",
        "--source",
        "https://example.com/announcement",
      ]),
      session,
    )
    expect(mocks.settle.mock.calls[0][0]).toMatchObject({
      questionId: "q1",
      resolution: "YES",
      source: "https://example.com/announcement",
    })
  })

  it("decide-proposal 必须且只能给出一个方向", async () => {
    const { session } = fakeContext()
    await expectRunToThrow(
      command("decide-proposal"),
      parseArgs(["--proposal-id", "p1"]),
      session,
      /--accept 或 --reject/,
    )

    await expectRunToThrow(
      command("decide-proposal"),
      parseArgs(["--proposal-id", "p1", "--accept", "--reject"]),
      session,
      /--accept 或 --reject/,
    )
  })

  it("report-delivery 只接受两种终态", async () => {
    const { mocks, session } = fakeContext()
    await expectRunToThrow(
      command("report-delivery"),
      parseArgs(["--notification-id", "n1", "--outcome", "FAILED"]),
      session,
      /--outcome/,
    )

    await command("report-delivery").run(
      parseArgs([
        "--notification-id",
        "n1",
        "--outcome",
        "DELIVERED",
        "--channel",
        "telegram",
      ]),
      session,
    )
    expect(mocks.reportDelivery).toHaveBeenCalledWith({
      notificationId: "n1",
      outcome: "DELIVERED",
      channel: "telegram",
    })
  })

  it("list-proposals 默认只看待处理", async () => {
    const { mocks, session } = fakeContext()
    await command("list-proposals").run(parseArgs([]), session)
    expect(mocks.listProposals).toHaveBeenCalledWith({ status: "PENDING" })
  })

  it("list-due 无参数时仍传一个对象，交给过程套用默认值", async () => {
    const { mocks, session } = fakeContext()
    await command("list-due").run(parseArgs([]), session)
    expect(mocks.listDue).toHaveBeenCalledWith({
      limit: undefined,
      now: undefined,
    })
  })
})
