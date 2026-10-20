import { parseArgs } from "./args"
import {
  AgentApi,
  Command,
  CommandContext,
  DecisionApi,
  TagsApi,
  commands,
  pairingRedeemUrl,
} from "./commands"

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
  "recordResolutionSource",
  "listAuditRecords",
  "listProposals",
  "decideProposal",
  "listPendingDeliveries",
  "reportDelivery",
  "issuePairingCode",
] as const

type MockAgent = Record<(typeof CALLER_METHODS)[number], jest.Mock>

const DECISION_METHODS = [
  "create",
  "byId",
  "updateNarrative",
  "setRubric",
  "attachPrediction",
  "detachPrediction",
] as const

type MockDecision = Record<(typeof DECISION_METHODS)[number], jest.Mock>

const TAGS_METHODS = [
  "listDomains",
  "addDomain",
  "setDecisionDomains",
  "listUntaggedDecisions",
  "renameDomain",
  "deleteDomain",
  "domainReport",
] as const

type MockTags = Record<(typeof TAGS_METHODS)[number], jest.Mock>

function fakeContext(): {
  /** 断言用：保留 jest.Mock 以便检查调用参数 */
  mocks: MockAgent
  decisionMocks: MockDecision
  tagsMocks: MockTags
  /** 传参用：直接复用真实形状，避免手抄一份后与实现脉动 */
  session: CommandContext
} {
  const mocks = Object.fromEntries(
    CALLER_METHODS.map((name) => [name, jest.fn().mockResolvedValue(name)]),
  ) as MockAgent

  const decisionMocks = Object.fromEntries(
    DECISION_METHODS.map((name) => [name, jest.fn().mockResolvedValue(name)]),
  ) as MockDecision

  const tagsMocks = Object.fromEntries(
    TAGS_METHODS.map((name) => [name, jest.fn().mockResolvedValue(name)]),
  ) as MockTags

  // SAFETY: mocks 覆盖 CALLER_METHODS 的每一个过程，是被测代码会触达的全部面。
  // 这里只是把 jest.fn 的 `mock` 属性从类型上抹掉，好让被测代码看到真实签名。
  const agent = mocks as unknown as AgentApi
  const decision = decisionMocks as unknown as DecisionApi
  const tags = tagsMocks as unknown as TagsApi

  return {
    mocks,
    decisionMocks,
    tagsMocks,
    session: {
      agent,
      decision,
      tags,
      userId: "user-1",
      email: "owner@example.com",
      credentialSource: "api-key-env",
    },
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
  session: CommandContext,
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

  describe("create-prediction —— 来源默认极性按调用上下文（ADR-0024）", () => {
    const MARKERS = ["AI_AGENT", "PI_CODING_AGENT", "PI_SESSION_ID"]
    const saved: Record<string, string | undefined> = {}

    // 测试不得依赖环境里的标记：本仓库的测试经常正是被 pi 起来的。
    beforeEach(() => {
      for (const marker of MARKERS) {
        saved[marker] = process.env[marker]
        delete process.env[marker]
      }
    })

    afterEach(() => {
      for (const marker of MARKERS) {
        const value = saved[marker]
        if (value === undefined) {
          delete process.env[marker]
        } else {
          process.env[marker] = value
        }
      }
    })

    async function predict(extra: string[] = []) {
      const { mocks, session } = fakeContext()
      await command("create-prediction").run(
        parseArgs([
          "--title",
          "会在三个月内拿到 offer",
          "--resolve-by",
          "2026-03-01",
          "--criteria",
          "邮件里出现正式 offer 字样",
          ...extra,
        ]),
        session,
      )
      return mocks.createPrediction.mock.calls[0][0]
    }

    it("无 agent 标记（人在终端里敲）⇒ 默认数字由当事人给出，审计记为 HUMAN 发起", async () => {
      const input = await predict()
      expect(input.statedByOwner).toBe(true)
      expect(input.initiator).toBe("HUMAN")
      expect(input.agentSessionId).toBeUndefined()
    })

    it("有 PI_CODING_AGENT 标记（pi 代跑）⇒ 默认待背书，且审计记为 AGENT 发起", async () => {
      process.env.PI_CODING_AGENT = "true"
      process.env.PI_SESSION_ID = "sess-1"
      const input = await predict()
      expect(input.statedByOwner).toBe(false)
      expect(input.initiator).toBe("AGENT")
      expect(input.agentSessionId).toBe("sess-1")
    })

    it("AI_AGENT 标记单独出现也足够", async () => {
      process.env.AI_AGENT = "pi"
      expect((await predict()).statedByOwner).toBe(false)
    })

    it("显式 --stated-by-owner 压过 agent 标记", async () => {
      process.env.AI_AGENT = "pi"
      expect((await predict(["--stated-by-owner"])).statedByOwner).toBe(true)
    })

    it("显式 --agent-collected 压过终端里的默认", async () => {
      expect((await predict(["--agent-collected"])).statedByOwner).toBe(false)
    })

    it("两个来源 flag 同时给出被拒（说明调用方自己没想清楚）", async () => {
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
          "--stated-by-owner",
          "--agent-collected",
        ]),
        session,
        /互斥/,
      )
    })
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

describe("决策命令（ADR-0019 / 0020 · ticket 05）", () => {
  it("create-decision 把叙事字段翻译成过程入参", async () => {
    const { decisionMocks, session } = fakeContext()

    await command("create-decision").run(
      parseArgs([
        "--statement",
        "接这个 offer",
        "--reasoning",
        "团队刚融资",
        "--unknown-info",
        "会不会被收购",
      ]),
      session,
    )

    expect(decisionMocks.create).toHaveBeenCalledWith({
      statement: "接这个 offer",
      reasoning: "团队刚融资",
      expectedOutcome: undefined,
      knownInfo: undefined,
      unknownInfo: "会不会被收购",
      // 没给 --domains 就是空数组："没标领域"与"标了 0 个领域"在这里是同一件事，
      // 服务端把空数组当"不动领域"。
      domains: [],
    })
  })

  it("set-rubric 把 --done/--not-done 的逗号列表翻成条目数组", async () => {
    const { decisionMocks, session } = fakeContext()

    await command("set-rubric").run(
      parseArgs([
        "--decision-id",
        "d1",
        "--done",
        "alternatives, baseRate",
        "--not-done",
        "premortem",
      ]),
      session,
    )

    expect(decisionMocks.setRubric).toHaveBeenCalledWith({
      decisionId: "d1",
      entries: [
        { itemKey: "alternatives", status: "DONE" },
        { itemKey: "baseRate", status: "DONE" },
        { itemKey: "premortem", status: "NOT_DONE" },
      ],
    })
  })

  it("set-rubric 不给任何条目时传空数组，而不是 undefined", async () => {
    const { decisionMocks, session } = fakeContext()

    await command("set-rubric").run(parseArgs(["--decision-id", "d1"]), session)

    expect(decisionMocks.setRubric).toHaveBeenCalledWith({
      decisionId: "d1",
      entries: [],
    })
  })

  it("update-narrative 翻成**局部**更新：没提到的字段是 undefined（不动它们）", async () => {
    const { decisionMocks, session } = fakeContext()

    await command("update-narrative").run(
      parseArgs([
        "--decision-id",
        "d1",
        "--reasoning",
        "当时觉得团队靠谱",
        "--reason",
        "复盘时发现当初把因果写反了",
      ]),
      session,
    )

    expect(decisionMocks.updateNarrative).toHaveBeenCalledWith({
      decisionId: "d1",
      statement: undefined,
      reasoning: "当时觉得团队靠谱",
      expectedOutcome: undefined,
      knownInfo: undefined,
      unknownInfo: undefined,
      reason: "复盘时发现当初把因果写反了",
    })
  })

  it('--action-due "" 归一为 null：撤销承诺时点是可写的，否则「清空动作」那条指引做不到', async () => {
    const { decisionMocks, session } = fakeContext()

    await command("update-narrative").run(
      parseArgs([
        "--decision-id",
        "d1",
        "--action",
        "",
        "--action-due",
        "",
        "--reason",
        "这个承诺不做了",
      ]),
      session,
    )

    expect(decisionMocks.updateNarrative).toHaveBeenCalledWith({
      decisionId: "d1",
      action: "",
      actionDueAt: null,
      statement: undefined,
      reasoning: undefined,
      expectedOutcome: undefined,
      knownInfo: undefined,
      unknownInfo: undefined,
      reason: "这个承诺不做了",
    })
  })

  it("attach-prediction 把可核到的清单事实**说出来**（ADR-0038 第五点）", async () => {
    const { decisionMocks, session } = fakeContext()
    // 返回值里带着它 ≠ 有人读过它：这里断言的是"说出了口"，不是"字段存在"。
    // 形状照抄真实返回值：`attachPrediction` 返回的是被挂上的**那条预测**
    // （`prisma.question.update` 的结果），所以 `id` 是 question id——提示里的
    // `--decision-id` 必须来自入参，取 `attached.id` 会拼出一条必然失败的命令。
    decisionMocks.attachPrediction.mockResolvedValue({
      id: "q1",
      rubricSuggestions: [
        {
          itemKey: "falsifiableCriteria",
          evidence: "已填写结算判据：下季度 CPI 同比 < 3%",
        },
      ],
    })
    const stderr = jest.spyOn(console, "error").mockImplementation(() => {})

    const result = await command("attach-prediction").run(
      parseArgs(["--decision-id", "d1", "--question-id", "q1"]),
      session,
    )

    const printed = stderr.mock.calls.map((call) => String(call[0])).join("\n")
    expect(printed).toContain("falsifiableCriteria")
    // 决策 id 来自入参，不是返回值的 `id`（后者是 question id）
    expect(printed).toContain("set-rubric --decision-id d1")
    expect(printed).not.toContain("--decision-id q1")
    // 提示走 stderr，返回值原样透传（stdout 仍是数据通道）
    expect(result).toEqual(
      expect.objectContaining({
        id: "q1",
        rubricSuggestions: expect.any(Array),
      }),
    )
    stderr.mockRestore()
  })

  it("detach-prediction 与 attach-prediction 对称：只需 question-id", async () => {
    const { decisionMocks, session } = fakeContext()

    await command("detach-prediction").run(
      parseArgs(["--question-id", "q1"]),
      session,
    )

    expect(decisionMocks.detachPrediction).toHaveBeenCalledWith({
      questionId: "q1",
    })
  })

  it("必需参数缺失时报错，且不触达过程", async () => {
    const { decisionMocks, session } = fakeContext()

    await expectRunToThrow(
      command("attach-prediction"),
      parseArgs(["--decision-id", "d1"]),
      session,
      /question-id/,
    )
    await expectRunToThrow(
      command("show-decision"),
      parseArgs([]),
      session,
      /decision-id/,
    )

    expect(decisionMocks.attachPrediction).not.toHaveBeenCalled()
    expect(decisionMocks.byId).not.toHaveBeenCalled()
  })

  it("--tags 按逗号拆成领域数组，只去外层空白（判重折叠交给服务端的领域规则）", async () => {
    const { decisionMocks, session } = fakeContext()

    await command("create-decision").run(
      parseArgs([
        "--statement",
        "接这个 offer",
        "--tags",
        " 投资/宏观 , 投资/公司业绩-Q3 ,",
      ]),
      session,
    )

    expect(decisionMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        domains: ["投资/宏观", "投资/公司业绩-Q3"],
      }),
    )
  })

  it("add-domain / list-domains 直译（造词只此一门，未知领域不会被静默创建）", async () => {
    const { tagsMocks, session } = fakeContext()

    await command("add-domain").run(
      parseArgs(["--name", "投资/估值与价格"]),
      session,
    )
    expect(tagsMocks.addDomain).toHaveBeenCalledWith({
      name: "投资/估值与价格",
    })

    await command("list-domains").run(parseArgs([]), session)
    expect(tagsMocks.listDomains).toHaveBeenCalledWith()
  })

  it("retag-decision 把补齐/重标的区别交给服务端判：--reason 原样透传", async () => {
    const { tagsMocks, session } = fakeContext()

    await command("retag-decision").run(
      parseArgs([
        "--decision-id",
        "d1",
        "--tags",
        "投资/宏观,投资/公司业绩-Q3",
        "--reason",
        "原先标太粗",
      ]),
      session,
    )

    expect(tagsMocks.setDecisionDomains).toHaveBeenCalledWith({
      decisionId: "d1",
      domains: ["投资/宏观", "投资/公司业绩-Q3"],
      reason: "原先标太粗",
    })
  })

  it("retag-decision 缺 decision-id 时报错，且不触达过程", async () => {
    const { tagsMocks, session } = fakeContext()

    await expectRunToThrow(
      command("retag-decision"),
      parseArgs(["--tags", "投资/宏观"]),
      session,
      /decision-id/,
    )
    expect(tagsMocks.setDecisionDomains).not.toHaveBeenCalled()
  })

  it("list-untagged-decisions 支持 --limit，不给则交给服务端默认值", async () => {
    const { tagsMocks, session } = fakeContext()

    await command("list-untagged-decisions").run(
      parseArgs(["--limit", "5"]),
      session,
    )
    expect(tagsMocks.listUntaggedDecisions).toHaveBeenCalledWith({ limit: 5 })

    await command("list-untagged-decisions").run(parseArgs([]), session)
    expect(tagsMocks.listUntaggedDecisions).toHaveBeenCalledWith({
      limit: undefined,
    })
  })

  describe("领域与悬空补录命令（ADR-0030 §十五 / ADR-0031 §五）", () => {
    it("domain-report 要求 --prefix：读数必须指明是哪个领域", async () => {
      const { tagsMocks, session } = fakeContext()

      await command("domain-report").run(
        parseArgs(["--prefix", "投资/宏观"]),
        session,
      )
      expect(tagsMocks.domainReport).toHaveBeenCalledWith({
        prefix: "投资/宏观",
      })

      await expectRunToThrow(
        command("domain-report"),
        parseArgs([]),
        session,
        /prefix/,
      )
      expect(tagsMocks.domainReport).toHaveBeenCalledTimes(1)
    })

    it("rename-domain 三个旗标缺一不可：改名必须留痕，没理由就不该发生", async () => {
      const { tagsMocks, session } = fakeContext()

      await command("rename-domain").run(
        parseArgs([
          "--from",
          "投资/宏观",
          "--to",
          "投资/宏观-v2",
          "--reason",
          "对齐 CPI",
        ]),
        session,
      )
      expect(tagsMocks.renameDomain).toHaveBeenCalledWith({
        from: "投资/宏观",
        to: "投资/宏观-v2",
        reason: "对齐 CPI",
      })

      await expectRunToThrow(
        command("rename-domain"),
        parseArgs(["--from", "投资/宏观", "--to", "投资/宏观-v2"]),
        session,
        /reason/,
      )
      // 缺理由时不得触达过程：否则改名会以“无痕”的形式发生
      expect(tagsMocks.renameDomain).toHaveBeenCalledTimes(1)
    })

    it("delete-domain 透传名字（有引用时由服务端拒绝，CLI 不自己判）", async () => {
      const { tagsMocks, session } = fakeContext()

      await command("delete-domain").run(
        parseArgs(["--name", "投资/旧词"]),
        session,
      )
      expect(tagsMocks.deleteDomain).toHaveBeenCalledWith({ name: "投资/旧词" })
    })

    it("record-resolution-source 原样透传来源与理由，缺 question-id 时当场报错", async () => {
      const { mocks, session } = fakeContext()

      await command("record-resolution-source").run(
        parseArgs([
          "--question-id",
          "q1",
          "--source",
          "https://data.example.org/cpi",
          "--rationale",
          "官方发布",
          "--reason",
          "旧链接失效",
        ]),
        session,
      )
      expect(mocks.recordResolutionSource).toHaveBeenCalledWith({
        questionId: "q1",
        source: "https://data.example.org/cpi",
        rationale: "官方发布",
        reason: "旧链接失效",
      })

      await expectRunToThrow(
        command("record-resolution-source"),
        parseArgs(["--source", "https://data.example.org/cpi"]),
        session,
        /question-id/,
      )
      expect(mocks.recordResolutionSource).toHaveBeenCalledTimes(1)
    })

    it("list-audit-records 透传筛选开关，limit 缺省为 50", async () => {
      const { mocks, session } = fakeContext()

      await command("list-audit-records").run(parseArgs([]), session)
      expect(mocks.listAuditRecords).toHaveBeenCalledWith({
        onlyAgentSessionOwnerClaims: false,
        limit: 50,
      })

      await command("list-audit-records").run(
        parseArgs(["--only-owner-claims", "--limit", "10"]),
        session,
      )
      expect(mocks.listAuditRecords).toHaveBeenLastCalledWith({
        onlyAgentSessionOwnerClaims: true,
        limit: 10,
      })
    })
  })

  describe("issue-pairing-code —— 网页的第二扇门（ADR-0035）", () => {
    const ENV = "FATEBOOK_ENABLE_PAIRING_LOGIN"
    const savedEnv: Record<string, string | undefined> = {}

    beforeEach(() => {
      savedEnv[ENV] = process.env[ENV]
      delete process.env[ENV]
      savedEnv.HOST_URL = process.env.HOST_URL
      delete process.env.HOST_URL
    })

    afterEach(() => {
      for (const key of [ENV, "HOST_URL"]) {
        const value = savedEnv[key]
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
    })

    it("开关关闭时不签发：指出去哪儿打开，而不是给一个兑不了的码", async () => {
      const { mocks, session } = fakeContext()

      await expectRunToThrow(
        command("issue-pairing-code"),
        parseArgs([]),
        session,
        /关闭/,
      )
      expect(mocks.issuePairingCode).not.toHaveBeenCalled()
    })

    it("只有邮箱（身份选择器）⇒ 拒绝签发，且不打扰过程层（ADR-0035）", async () => {
      process.env[ENV] = "1"
      const { mocks, session } = fakeContext()

      // FATEBOOK_AGENT_USER_EMAIL 不含秘密：谁设了都能以该身份跑命令，
      // 因此它证明得了身份，证明不了「持有凭据」。
      await expectRunToThrow(
        command("issue-pairing-code"),
        parseArgs([]),
        { ...session, credentialSource: "email-env" },
        /要求持有凭据/,
      )
      expect(mocks.issuePairingCode).not.toHaveBeenCalled()
    })

    it("开关打开后透传过程结果，并给出兑换页地址", async () => {
      process.env[ENV] = "1"
      process.env.HOST_URL = "https://fatebook.home:3000/"
      const { mocks, session } = fakeContext()
      mocks.issuePairingCode.mockResolvedValue({
        code: "ABCD2345",
        expiresAt: "2026-10-13T12:10:00.000Z",
      })

      const result = await command("issue-pairing-code").run(
        parseArgs([]),
        session,
      )

      expect(mocks.issuePairingCode).toHaveBeenCalledTimes(1)
      expect(result).toEqual({
        code: "ABCD2345",
        expiresAt: "2026-10-13T12:10:00.000Z",
        redeemUrl: "https://fatebook.home:3000/pair",
      })
    })

    it("没有 HOST_URL 时兑换页地址落到本机明文端口（NEXTAUTH_URL 指向 /api/auth，不能用）", () => {
      expect(pairingRedeemUrl({})).toBe("http://localhost:3000/pair")
      expect(pairingRedeemUrl({ NEXTAUTH_URL: "https://x/api/auth" })).toBe(
        "http://localhost:3000/pair",
      )
    })
  })

  it("--help 里能看到新命令（它们必须可被发现）", () => {
    const names = commands.map((entry) => entry.name)
    expect(names).toEqual(
      expect.arrayContaining([
        "create-decision",
        "attach-prediction",
        "detach-prediction",
        "set-rubric",
        "update-narrative",
        "show-decision",
        "add-domain",
        "list-domains",
        "domain-report",
        "retag-decision",
        "list-untagged-decisions",
        "rename-domain",
        "delete-domain",
        "record-resolution-source",
        "list-audit-records",
        "issue-pairing-code",
      ]),
    )
  })
})
