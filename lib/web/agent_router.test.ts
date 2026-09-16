import { agentRouter } from "./agent_router"
import prisma from "../prisma"

// trpc-transformer 经 superjson 是 ESM，jsdom 下加载不了；直接调用过程不需要序列化。
jest.mock("trpc-transformer", () => ({ __esModule: true, default: undefined }))

// 避免经 notifications -> _utils_server -> node-fetch (ESM) 的链
jest.mock("./notifications", () => ({
  createNotification: jest.fn(),
  sendEmailReadyToResolveNotification: jest.fn(),
  sendBatchedEmails: jest.fn(),
  sendEmailWithTemplateUnbatched: jest.fn(),
  sendEmailUnbatched: jest.fn(),
  fatebookEmailFooter: jest.fn(),
}))

jest.mock("./question_url", () => ({
  getQuestionUrl: jest.fn(() => "http://localhost:3000/q/q1"),
  extractQuestionId: jest.fn(),
}))

jest.mock("../prisma", () => ({
  __esModule: true,
  default: {
    question: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    decision: { findFirst: jest.fn(), count: jest.fn() },
    forecast: { create: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
    notification: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    resolutionProposal: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  },
}))

// 结算走既有的 resolution 管道；本文件只关心 agent 层的权限分层与落库时机。
jest.mock("./resolution", () => ({
  handleQuestionResolution: jest.fn(),
  rescoreResolvedQuestion: jest.fn(),
}))

// 领域写时复制（ADR-0030 §三）：这里只断言“确实问了同一个问题”，真实效果由
// `e2e/domain-tracking.spec.ts` 在真库上验证。
jest.mock("./domain_tags", () => {
  const actual = jest.requireActual("./domain_tags")
  return {
    propagateDecisionDomainsToQuestion: jest.fn(),
    // 纯谓词就用真实现：把它也 mock 掉，等于把“计数与列表用同一个判据”测没了。
    untaggedDecisionWhere: actual.untaggedDecisionWhere,
  }
})

const questionCreate = (
  prisma as unknown as { question: { create: jest.Mock } }
).question.create
const forecastCreate = (
  prisma as unknown as { forecast: { create: jest.Mock } }
).forecast.create
const notificationCreate = (
  prisma as unknown as { notification: { create: jest.Mock } }
).notification.create
const questionFindFirst = (
  prisma as unknown as { question: { findFirst: jest.Mock } }
).question.findFirst
const proposalCreate = (
  prisma as unknown as { resolutionProposal: { create: jest.Mock } }
).resolutionProposal.create

const proposalFindFirst = (
  prisma as unknown as { resolutionProposal: { findFirst: jest.Mock } }
).resolutionProposal.findFirst

const proposalUpdate = (
  prisma as unknown as { resolutionProposal: { update: jest.Mock } }
).resolutionProposal.update
const notificationFindMany = (
  prisma as unknown as { notification: { findMany: jest.Mock } }
).notification.findMany
const notificationFindFirst = (
  prisma as unknown as { notification: { findFirst: jest.Mock } }
).notification.findFirst
const notificationUpdate = (
  prisma as unknown as { notification: { update: jest.Mock } }
).notification.update
const handleQuestionResolution = (
  jest.requireMock("./resolution") as { handleQuestionResolution: jest.Mock }
).handleQuestionResolution
const forecastFindMany = (
  prisma as unknown as { forecast: { findMany: jest.Mock } }
).forecast.findMany
const forecastUpdateMany = (
  prisma as unknown as { forecast: { updateMany: jest.Mock } }
).forecast.updateMany
const questionFindMany = (
  prisma as unknown as { question: { findMany: jest.Mock } }
).question.findMany
const questionFindUnique = (
  prisma as unknown as { question: { findUnique: jest.Mock } }
).question.findUnique
const questionUpdate = (
  prisma as unknown as { question: { update: jest.Mock } }
).question.update
const decisionFindFirst = (
  prisma as unknown as { decision: { findFirst: jest.Mock } }
).decision.findFirst
const rescoreResolvedQuestion = (
  jest.requireMock("./resolution") as { rescoreResolvedQuestion: jest.Mock }
).rescoreResolvedQuestion
const propagateDecisionDomainsToQuestion = (
  jest.requireMock("./domain_tags") as {
    propagateDecisionDomainsToQuestion: jest.Mock
  }
).propagateDecisionDomainsToQuestion

type CallerInput = Parameters<typeof agentRouter.createCaller>[0]

const asOwner = () =>
  agentRouter.createCaller({ userId: "user-1" } as CallerInput)

const BASE = {
  title: "会在 6 月底前收到正式 offer",
  resolveBy: new Date("2026-06-30T00:00:00Z"),
  resolutionCriteria: "邮件中出现正式 offer 字样",
  // 路由层没有默认值（ADR-0024），因此每个用例都得明说这个数字是谁给的。
  statedByOwner: true,
  // 审计线索也是必填（ADR-0027）：发起方类别不给默认值。
  initiator: "HUMAN",
} as const

beforeEach(() => {
  jest.clearAllMocks()
  questionCreate.mockResolvedValue({ id: "q1" })
  forecastCreate.mockResolvedValue({ id: 7 })
  notificationCreate.mockResolvedValue({})
})

/**
 * ADR-0031 §二 / ADR-0034 §五：到期队列里的两种“没结算”必须分栏。
 *
 * 自证用例：把 `listDue` 里的分流去掉（两栏塞同一批），下面的断言立刻变红——
 * 而“混在一起”的后果是让人把“没法定论”读成“我还没去结算”，于是去替别人签字。
 */
describe("agent.listDue —— 可结算与悬空未结算必须分栏", () => {
  const forecast = {
    id: 1,
    userId: "user-1",
    forecast: 0.7,
    endorsed: true,
    createdAt: new Date(0),
  }
  const dueQuestion = {
    id: "due-1",
    title: "到点该结算了",
    resolveBy: new Date("2026-01-01T00:00:00Z"),
    resolved: false,
    resolutionSource: null,
    confirmedByUserId: null,
    oracleKind: "PUBLIC_FACT",
    provenance: "HUMAN",
    resolutionCriteria: "判据",
    scoringAnchor: null,
    forecasts: [forecast],
  }
  const danglingQuestion = {
    id: "dangling-1",
    title: "别人确认了，但没有可核查来源",
    resolveBy: new Date("2026-01-01T00:00:00Z"),
    resolved: true,
    resolutionSource: null,
    confirmedByUserId: "someone-else",
    oracleKind: "PUBLIC_FACT",
    provenance: "HUMAN",
    resolutionCriteria: "判据",
    scoringAnchor: null,
    forecasts: [{ ...forecast, id: 2 }],
  }

  it("悬空项只出现在 dangling 栏，并带上成因", async () => {
    questionFindMany
      .mockResolvedValueOnce([dueQuestion])
      .mockResolvedValueOnce([danglingQuestion])

    const result = await asOwner().listDue({})

    expect(result.settleable.map((q) => q.id)).toEqual(["due-1"])
    expect(result.dangling.map((q) => q.id)).toEqual(["dangling-1"])
    expect(result.dangling[0].reason).toContain("来源")
  })

  it("未标领域计数随队列一起返回，且不依赖有没有到期项（ADR-0030 §八）", async () => {
    const decisionCount = (
      prisma as unknown as { decision: { count: jest.Mock } }
    ).decision.count
    // 队列两栏都是空的——这正是 §八 要覆盖的情形：那一行不能依附在到期项上。
    questionFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    decisionCount.mockResolvedValue(3)

    const result = await asOwner().listDue({})

    expect(result.settleable).toEqual([])
    expect(result.dangling).toEqual([])
    expect(result.untaggedDecisions).toBe(3)
  })

  it("有可核查来源的结算，即使由他人确认也不算悬空", async () => {
    questionFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { ...danglingQuestion, resolutionSource: "https://example.org/x" },
      ])

    const result = await asOwner().listDue({})

    expect(result.dangling).toEqual([])
  })
})

/**
 * 锁定 ADR-0008 在选择 E 下、并经 ADR-0024 修正后的判据：
 * **由谁给这个数字，由调用方显式声明**（`statedByOwner`）——路由层不给默认值。
 *
 * 这组断言存在的理由：polarity 反转过一次（原为可选的 --instructed），而"反转错了"
 * 不会有任何症状——它只会让当事人的数字静默地不进校准，或反过来让 agent 的数字
 * 静默地变成当事人的判断。
 */
describe("agent.createPrediction —— 录入来源与背书（ADR-0008 / ADR-0024）", () => {
  it("显式声明数字来自当事人 ⇒ HUMAN 且创建即已背书", async () => {
    const result = await asOwner().createPrediction({
      ...BASE,
      probability: 0.7,
      statedByOwner: true,
    })

    expect(questionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ provenance: "HUMAN" }),
    })
    expect(forecastCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provenance: "HUMAN",
        endorsed: true,
        endorsedAt: expect.any(Date),
      }),
    })
    expect(notificationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: "新增已确认预测",
        tags: ["quantified"],
      }),
    })
    expect(result).toEqual({
      questionId: "q1",
      forecastId: 7,
      quantified: true,
      provenance: "HUMAN",
    })
  })

  it("显式声明数字来自 agent ⇒ AGENT 且未背书", async () => {
    const result = await asOwner().createPrediction({
      ...BASE,
      probability: 0.7,
      statedByOwner: false,
    })

    expect(questionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ provenance: "AGENT" }),
    })
    expect(forecastCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provenance: "AGENT",
        endorsed: false,
        endorsedAt: null,
      }),
    })
    expect(notificationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: "新增待背书预测",
        tags: ["unendorsed"],
      }),
    })
    expect(result.provenance).toBe("AGENT")
  })

  it("审计线索落库：发起方类别与会话标识分开存（ADR-0027）", async () => {
    await asOwner().createPrediction({
      ...BASE,
      probability: 0.7,
      initiator: "AGENT",
      agentSessionId: "sess-42",
    })

    expect(questionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        initiator: "AGENT",
        agentSessionId: "sess-42",
      }),
    })
    expect(forecastCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        initiator: "AGENT",
        agentSessionId: "sess-42",
      }),
    })
  })

  it("审计清单能筛出“来自会话却自称数字由当事人给出”的记录（去掉过滤即变红）", async () => {
    forecastFindMany.mockResolvedValue([
      {
        id: 1,
        questionId: "q1",
        forecast: 0.6,
        provenance: "HUMAN",
        endorsed: true,
        initiator: "AGENT",
        agentSessionId: "s1",
        createdAt: new Date(),
        question: { title: "来自会话、自称人给的" },
      },
    ])

    const all = await asOwner().listAuditRecords({
      onlyAgentSessionOwnerClaims: false,
      limit: 50,
    })
    expect(all[0].ownerClaimFromSession).toBe(true)

    await asOwner().listAuditRecords({
      onlyAgentSessionOwnerClaims: true,
      limit: 50,
    })
    expect(forecastFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-1",
          initiator: "AGENT",
          provenance: "HUMAN",
        }),
      }),
    )
  })

  it("不给概率（未量化，ADR-0011）⇒ 不创建 Forecast，且不是待背书", async () => {
    const result = await asOwner().createPrediction({
      ...BASE,
      statedByOwner: true,
    })

    expect(forecastCreate).not.toHaveBeenCalled()
    expect(notificationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: "新增未量化命题",
        tags: ["unquantified"],
      }),
    })
    expect(result).toEqual({
      questionId: "q1",
      forecastId: null,
      quantified: false,
      provenance: "HUMAN",
    })
  })

  it("SELF_REPORT 缺评分锚点被拒（ADR-0002）", async () => {
    await expect(
      asOwner().createPrediction({
        ...BASE,
        oracleKind: "SELF_REPORT",
        probability: 0.7,
      }),
    ).rejects.toThrow(/评分锚点/)

    expect(questionCreate).not.toHaveBeenCalled()
  })
})

describe("agent.listOpen —— 只报我的读数（ADR-0028 锚定保护的 CLI 面）", () => {
  it("他人刚押的数字不会被当成这条题的读数报给我（去掉过滤即变红）", async () => {
    questionFindMany.mockResolvedValue([
      {
        id: "q1",
        title: "共享题",
        resolveBy: new Date("2030-01-01"),
        resolved: false,
        oracleKind: "PUBLIC_FACT",
        provenance: "HUMAN",
        resolutionCriteria: "证据出现即算成",
        scoringAnchor: null,
        forecasts: [
          {
            id: 1,
            userId: "someone-else",
            forecast: 0.9,
            endorsed: true,
            createdAt: new Date("2026-01-02"),
          },
          {
            id: 2,
            userId: "user-1",
            forecast: 0.3,
            endorsed: true,
            createdAt: new Date("2026-01-01"),
          },
        ],
      },
    ])

    const [row] = await asOwner().listOpen({ limit: 50 })

    // 他人的 0.9 更新，但不是“我的”读数——报给我就等于在我提交前锚定了我
    expect(row.latestForecast?.forecast).toBe(0.3)
    expect(row.quantified).toBe(true)
  })

  it("只有他人押过时，这条题对我仍是未量化", async () => {
    questionFindMany.mockResolvedValue([
      {
        id: "q2",
        title: "别人押过、我还没",
        resolveBy: new Date("2030-01-01"),
        resolved: false,
        oracleKind: "PUBLIC_FACT",
        provenance: "HUMAN",
        resolutionCriteria: "证据出现即算成",
        scoringAnchor: null,
        forecasts: [
          {
            id: 3,
            userId: "someone-else",
            forecast: 0.9,
            endorsed: true,
            createdAt: new Date("2026-01-02"),
          },
        ],
      },
    ])

    const [row] = await asOwner().listOpen({ limit: 50 })

    expect(row.latestForecast).toBeNull()
    expect(row.quantified).toBe(false)
  })
})

describe("agent.decideProposal —— 确认权属于预测的 Owner（ADR-0029）", () => {
  const pendingProposal = (over: Record<string, unknown> = {}) => ({
    id: "p1",
    status: "PENDING",
    resolution: "YES",
    source: "https://example.com/evidence",
    rationale: null,
    questionId: "q1",
    question: {
      id: "q1",
      userId: "owner-a",
      type: "BINARY",
      resolved: false,
      forecasts: [{ userId: "user-1" }],
      ...((over.question as Record<string, unknown>) ?? {}),
    },
    ...over,
  })

  it("押注者（不是建题者）可以确认这条提案", async () => {
    proposalFindFirst.mockResolvedValue(pendingProposal())
    proposalUpdate.mockResolvedValue({ id: "p1" })

    const result = await asOwner().decideProposal({
      proposalId: "p1",
      accept: true,
    })

    expect(result).toEqual({ id: "p1" })
    expect(handleQuestionResolution).toHaveBeenCalled()
  })

  it("既不是建题者、也没押过注 ⇒ 拒绝，且错误信息说明原因", async () => {
    proposalFindFirst.mockResolvedValue(
      pendingProposal({
        question: { id: "q1", userId: "owner-a", forecasts: [] },
      }),
    )

    await expect(
      asOwner().decideProposal({ proposalId: "p1", accept: true }),
    ).rejects.toThrow(/押过注|Owner/)

    expect(handleQuestionResolution).not.toHaveBeenCalled()
    expect(proposalUpdate).not.toHaveBeenCalled()
  })
})

describe("agent.settle —— 结算权限按判据类型分层（ADR-0004 / issue 07）", () => {
  const ownedQuestion = (over: Record<string, unknown> = {}) => ({
    id: "q1",
    userId: "user-1",
    title: "会在 6 月底前收到正式 offer",
    resolved: false,
    oracleKind: "PUBLIC_FACT",
    type: "BINARY",
    resolutionCriteria: "邮件中出现正式 offer 字样",
    forecasts: [],
    ...over,
  })

  it("SELF_REPORT：不被 agent 直接结算，改为要求本人报告", async () => {
    questionFindFirst.mockResolvedValue(
      ownedQuestion({ oracleKind: "SELF_REPORT" }),
    )

    const result = await asOwner().settle({
      questionId: "q1",
      resolution: "YES",
    })

    expect(result).toEqual({ mode: "requires-human-report" })
    expect(handleQuestionResolution).not.toHaveBeenCalled()
    expect(proposalCreate).not.toHaveBeenCalled()
    expect(notificationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: "需要你本人报告结论",
        tags: ["needs-self-report"],
      }),
    })
  })

  it("建题者不能替他人在自我报告上作结论：提醒发给预测的 Owner，而不是调用方（ADR-0029）", async () => {
    questionFindFirst.mockResolvedValue(
      ownedQuestion({
        oracleKind: "SELF_REPORT",
        userId: "owner-a",
        forecasts: [{ userId: "forecaster-b" }],
      }),
    )

    const result = await asOwner().settle({
      questionId: "q1",
      resolution: "YES",
    })

    expect(result).toEqual({ mode: "requires-human-report" })
    expect(handleQuestionResolution).not.toHaveBeenCalled()
    expect(proposalCreate).not.toHaveBeenCalled()
    expect(notificationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "forecaster-b" }),
    })
    expect(notificationCreate).not.toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "user-1" }),
    })
  })

  it("该 Prediction 的 Owner 本人可以在自我报告上作结论", async () => {
    questionFindFirst.mockResolvedValue(
      ownedQuestion({
        oracleKind: "SELF_REPORT",
        userId: "owner-a",
        forecasts: [{ userId: "user-1" }],
      }),
    )

    const result = await asOwner().settle({
      questionId: "q1",
      resolution: "YES",
    })

    expect(result).toEqual({ mode: "settled" })
    expect(handleQuestionResolution).toHaveBeenCalled()
  })

  it("AGENT_OBSERVABLE：只能出提案，等用户确认", async () => {
    questionFindFirst.mockResolvedValue(
      ownedQuestion({ oracleKind: "AGENT_OBSERVABLE" }),
    )
    proposalCreate.mockResolvedValue({ id: "p1" })

    const result = await asOwner().settle({
      questionId: "q1",
      resolution: "YES",
      source: "https://example.com/evidence",
    })

    expect(result).toEqual({
      mode: "proposed",
      proposalId: "p1",
      downgraded: false,
    })
    expect(handleQuestionResolution).not.toHaveBeenCalled()
    expect(notificationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ tags: ["proposal"] }),
    })
  })

  it("PUBLIC_FACT 且附来源：可自行结算，且来源落库（不只在通知正文）", async () => {
    questionFindFirst.mockResolvedValue(ownedQuestion())

    const result = await asOwner().settle({
      questionId: "q1",
      resolution: "YES",
      source: "https://example.com/evidence",
      rationale: "公告已发布",
    })

    expect(result).toEqual({ mode: "settled" })
    expect(handleQuestionResolution).toHaveBeenCalledWith(
      "q1",
      "YES",
      "BINARY",
      undefined,
      {
        source: "https://example.com/evidence",
        rationale: "公告已发布",
        // ADR-0031 §三：结算记录要记下谁确认的（授权矩阵已判定调用者可以结算）
        confirmedByUserId: "user-1",
      },
    )
    expect(proposalCreate).not.toHaveBeenCalled()
  })

  it("PUBLIC_FACT 但无来源：降级为提案（ADR-0004 的硬约束）", async () => {
    questionFindFirst.mockResolvedValue(ownedQuestion())
    proposalCreate.mockResolvedValue({ id: "p2" })

    const result = await asOwner().settle({
      questionId: "q1",
      resolution: "YES",
    })

    expect(result).toEqual({
      mode: "proposed",
      proposalId: "p2",
      downgraded: true,
    })
    expect(handleQuestionResolution).not.toHaveBeenCalled()
    expect(notificationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tags: ["proposal", "missing-source"],
      }),
    })
  })

  it("已结算的问题不再被重复结算", async () => {
    questionFindFirst.mockResolvedValue(ownedQuestion({ resolved: true }))

    await expect(
      asOwner().settle({ questionId: "q1", resolution: "YES" }),
    ).rejects.toThrow(/已结算/)
    expect(handleQuestionResolution).not.toHaveBeenCalled()
  })
})

describe("触达状态机（ADR-0017 / issue 08）", () => {
  it("listPendingDeliveries 只取 PENDING——已发送的自然不再出现", async () => {
    notificationFindMany.mockResolvedValue([])

    await asOwner().listPendingDeliveries({})

    expect(notificationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1", deliveryState: "PENDING" },
      }),
    )
  })

  it("reportDelivery(DELIVERED)：置 DELIVERED 并记下时间与通道", async () => {
    notificationFindFirst.mockResolvedValue({ id: "n1", userId: "user-1" })
    notificationUpdate.mockResolvedValue({})

    await asOwner().reportDelivery({
      notificationId: "n1",
      outcome: "DELIVERED",
      channel: "telegram",
    })

    expect(notificationUpdate).toHaveBeenCalledWith({
      where: { id: "n1" },
      data: {
        deliveryState: "DELIVERED",
        deliveredAt: expect.any(Date),
        deliveredVia: "telegram",
      },
    })
  })

  it("reportDelivery(DELIVERED) 未给通道时记为 in-app", async () => {
    notificationFindFirst.mockResolvedValue({ id: "n1", userId: "user-1" })
    notificationUpdate.mockResolvedValue({})

    await asOwner().reportDelivery({
      notificationId: "n1",
      outcome: "DELIVERED",
    })

    expect(notificationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ deliveredVia: "in-app" }),
      }),
    )
  })

  it("reportDelivery(NOT_NEEDED)：不记时间与通道", async () => {
    notificationFindFirst.mockResolvedValue({ id: "n1", userId: "user-1" })
    notificationUpdate.mockResolvedValue({})

    await asOwner().reportDelivery({
      notificationId: "n1",
      outcome: "NOT_NEEDED",
    })

    expect(notificationUpdate).toHaveBeenCalledWith({
      where: { id: "n1" },
      data: {
        deliveryState: "NOT_NEEDED",
        deliveredAt: null,
        deliveredVia: null,
      },
    })
  })

  it("回报不属于自己的通知 → NOT_FOUND", async () => {
    notificationFindFirst.mockResolvedValue(null)

    await expect(
      asOwner().reportDelivery({ notificationId: "n1", outcome: "DELIVERED" }),
    ).rejects.toThrow(/找不到该通知/)
    expect(notificationUpdate).not.toHaveBeenCalled()
  })
})

describe("agent.createPrediction 的决策归属（ADR-0019 · ticket 03）", () => {
  it("创建时可直接指定所属决策", async () => {
    decisionFindFirst.mockResolvedValue({ id: "d1" })
    questionCreate.mockResolvedValue({ id: "q1" })

    await asOwner().createPrediction({ ...BASE, decisionId: "d1" })

    expect(decisionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "d1", userId: "user-1" },
      }),
    )
    expect(questionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ decisionId: "d1" }),
      }),
    )
    // ADR-0030 §三：**创建时就归属决策**也是“挂接”，领域必须写时复制过来。
    // 少了这一步不会有任何症状：题照常建，只是这条 Prediction 永远不带领域、
    // 于是不进任何领域读数（去掉本断言对应的代码即变红）。
    expect(propagateDecisionDomainsToQuestion).toHaveBeenCalledWith("d1", "q1")
  })

  it("不给 decisionId 时 decisionId 落为 null，而不是 undefined", async () => {
    questionCreate.mockResolvedValue({ id: "q1" })

    await asOwner().createPrediction({ ...BASE })

    expect(decisionFindFirst).not.toHaveBeenCalled()
    // 没有挂接就不该有领域传播（不要做多余的一次写）
    expect(propagateDecisionDomainsToQuestion).not.toHaveBeenCalled()
    expect(questionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ decisionId: null }),
      }),
    )
  })

  it("不能挂到别人的决策上——挂之前就拒，不落库", async () => {
    decisionFindFirst.mockResolvedValue(null)

    await expect(
      asOwner().createPrediction({ ...BASE, decisionId: "d-of-someone-else" }),
    ).rejects.toThrow(/找不到该决策/)

    expect(questionCreate).not.toHaveBeenCalled()
  })
})

describe("agent.endorse —— 背书后必须真的改变校准（ADR-0008 / issue 04）", () => {
  it("背书：置 endorsed + endorsedAt，并对已结算的问题触发重算", async () => {
    forecastFindMany.mockResolvedValue([
      { id: 7, questionId: "q1" },
      { id: 8, questionId: "q2" },
    ])
    forecastUpdateMany.mockResolvedValue({ count: 2 })
    // 只有 q1 已结算——q2 无需重算
    questionFindMany.mockResolvedValue([{ id: "q1" }])

    const result = await asOwner().endorse({ forecastId: 7 })

    expect(forecastUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: [7, 8] } },
      data: { endorsed: true, endorsedAt: expect.any(Date) },
    })
    expect(result).toEqual({ endorsed: [7, 8], rescored: ["q1"] })
    // 这一行是 ADR-0008 的关键：不重算，界面上"尚未背书"会消失，
    // 而校准里永远没有这一笔，且没有任何症状。
    expect(rescoreResolvedQuestion).toHaveBeenCalledWith("q1")
    expect(rescoreResolvedQuestion).toHaveBeenCalledTimes(1)
  })

  it("没有属于自己且未背书的预测值 → NOT_FOUND", async () => {
    forecastFindMany.mockResolvedValue([])

    await expect(asOwner().endorse({ forecastId: 7 })).rejects.toThrow(
      /没有找到属于当前 owner 且未背书的预测值/,
    )
    expect(forecastUpdateMany).not.toHaveBeenCalled()
  })

  it("forecastId 与 questionId 都不给 → BAD_REQUEST", async () => {
    await expect(asOwner().endorse({})).rejects.toThrow(
      /需要 forecastId 或 questionId/,
    )
    expect(forecastFindMany).not.toHaveBeenCalled()
  })
})

/**
 * 悬空的唯一出口（ADR-0031 §五）。
 *
 * 为什么这组守在这里：悬空是**合法状态**，但它不能是死路——而这条路只有一条。它同时
 * 管着三件没有症状的事：授权（补来源会改变**别人**的计量）、不得无声改写既有口径、
 * 以及"补录之后分数真的补上"（不重算的话 §五 的承诺只停在数据行上）。此前这个 handler
 * 一行都没有被执行过。
 */
describe("agent.recordResolutionSource —— 补录可核查来源（ADR-0031 §五）", () => {
  const question = (over: Record<string, unknown> = {}) => ({
    id: "q1",
    resolved: true,
    resolutionSource: null,
    userId: "user-1",
    forecasts: [{ userId: "user-1" }],
    ...over,
  })

  beforeEach(() => {
    questionUpdate.mockResolvedValue({})
  })

  it("补录来源 ⇒ 写库并重算，让该题所有预测真的计入（去掉重算即变红）", async () => {
    questionFindUnique.mockResolvedValue(question())

    const result = await asOwner().recordResolutionSource({
      questionId: "q1",
      source: "https://data.example.org/cpi/2026-03",
    })

    expect(questionUpdate).toHaveBeenCalledWith({
      where: { id: "q1" },
      data: {
        resolutionSource: "https://data.example.org/cpi/2026-03",
        resolutionRationale: undefined,
      },
    })
    // §五 承诺"补录后全部计入"——只有重算才让这句话落在分数上，而不是只落在列上
    expect(rescoreResolvedQuestion).toHaveBeenCalledWith("q1")
    expect(rescoreResolvedQuestion).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      questionId: "q1",
      source: "https://data.example.org/cpi/2026-03",
      rewritten: false,
    })
  })

  it("既不是建题者、也没在这条题上押过注 ⇒ 拒绝，且不写库、不重算（去掉守卫即变红）", async () => {
    questionFindUnique.mockResolvedValue(
      question({ userId: "owner-a", forecasts: [{ userId: "forecaster-b" }] }),
    )

    await expect(
      asOwner().recordResolutionSource({
        questionId: "q1",
        source: "https://example.org/evidence",
      }),
    ).rejects.toThrow(/押过注|当事方/)

    expect(questionUpdate).not.toHaveBeenCalled()
    expect(rescoreResolvedQuestion).not.toHaveBeenCalled()
  })

  it("押注者即使不是建题者也能补：被这次判定影响到的人就有权补", async () => {
    questionFindUnique.mockResolvedValue(
      question({ userId: "owner-a", forecasts: [{ userId: "user-1" }] }),
    )

    await expect(
      asOwner().recordResolutionSource({
        questionId: "q1",
        source: "https://example.org/evidence",
      }),
    ).resolves.toEqual({
      questionId: "q1",
      source: "https://example.org/evidence",
      rewritten: false,
    })
  })

  it("还没结算 ⇒ 拒绝（来源是随结算写入的，没有结算就没有东西可补）", async () => {
    questionFindUnique.mockResolvedValue(question({ resolved: false }))

    await expect(
      asOwner().recordResolutionSource({
        questionId: "q1",
        source: "https://example.org/evidence",
      }),
    ).rejects.toThrow(/还没结算/)

    expect(questionUpdate).not.toHaveBeenCalled()
    expect(rescoreResolvedQuestion).not.toHaveBeenCalled()
  })

  it("已有来源却不给理由地改写 ⇒ 拒绝，且什么都不写（去掉守卫即变红）", async () => {
    questionFindUnique.mockResolvedValue(
      question({ resolutionSource: "https://old.example.org/evidence" }),
    )

    await expect(
      asOwner().recordResolutionSource({
        questionId: "q1",
        source: "https://new.example.org/evidence",
      }),
    ).rejects.toThrow(/理由/)

    expect(questionUpdate).not.toHaveBeenCalled()
    expect(rescoreResolvedQuestion).not.toHaveBeenCalled()
  })

  it("改写已有来源 + 给理由 ⇒ 成功，并明确报出这是一次改写（不是补缺）", async () => {
    questionFindUnique.mockResolvedValue(
      question({ resolutionSource: "https://old.example.org/evidence" }),
    )

    const result = await asOwner().recordResolutionSource({
      questionId: "q1",
      source: "https://new.example.org/evidence",
      reason: "旧链接失效，换成官方存档",
    })

    expect(result.rewritten).toBe(true)
    expect(rescoreResolvedQuestion).toHaveBeenCalledWith("q1")
  })

  it("找不到这条题 ⇒ NOT_FOUND", async () => {
    questionFindUnique.mockResolvedValue(null)

    await expect(
      asOwner().recordResolutionSource({
        questionId: "不存在",
        source: "https://example.org/evidence",
      }),
    ).rejects.toThrow(/找不到/)
  })
})
