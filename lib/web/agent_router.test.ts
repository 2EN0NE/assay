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
    question: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
    decision: { findFirst: jest.fn() },
    forecast: { create: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
    notification: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    resolutionProposal: { create: jest.fn() },
  },
}))

// 结算走既有的 resolution 管道；本文件只关心 agent 层的权限分层与落库时机。
jest.mock("./resolution", () => ({
  handleQuestionResolution: jest.fn(),
  rescoreResolvedQuestion: jest.fn(),
}))

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
const decisionFindFirst = (
  prisma as unknown as { decision: { findFirst: jest.Mock } }
).decision.findFirst
const rescoreResolvedQuestion = (
  jest.requireMock("./resolution") as { rescoreResolvedQuestion: jest.Mock }
).rescoreResolvedQuestion

type CallerInput = Parameters<typeof agentRouter.createCaller>[0]

const asOwner = () =>
  agentRouter.createCaller({ userId: "user-1" } as CallerInput)

const BASE = {
  title: "会在 6 月底前收到正式 offer",
  resolveBy: new Date("2026-06-30T00:00:00Z"),
  resolutionCriteria: "邮件中出现正式 offer 字样",
} as const

beforeEach(() => {
  jest.clearAllMocks()
  questionCreate.mockResolvedValue({ id: "q1" })
  forecastCreate.mockResolvedValue({ id: 7 })
  notificationCreate.mockResolvedValue({})
})

/**
 * 锁定 ADR-0008 在选择 E 下的判据：**数字由当事人给出即已背书**，
 * 只有显式声明"这个数字是 Agent 自己取得的"（--agent-collected）才进未背书队列。
 *
 * 这组断言存在的理由：polarity 反转过一次（原为可选的 --instructed），
 * 而"反转错了"不会有任何症状——它只会让当事人的数字静默地不进校准。
 */
describe("agent.createPrediction —— 录入来源与背书（ADR-0008 / 选择 E）", () => {
  it("默认（数字来自当事人）⇒ AGENT_INSTRUCTED 且创建即已背书", async () => {
    const result = await asOwner().createPrediction({
      ...BASE,
      probability: 0.7,
    })

    expect(questionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ provenance: "AGENT_INSTRUCTED" }),
    })
    expect(forecastCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provenance: "AGENT_INSTRUCTED",
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
      provenance: "AGENT_INSTRUCTED",
    })
  })

  it("显式 --agent-collected（数字是 Agent 自己取得的）⇒ AGENT 且未背书", async () => {
    const result = await asOwner().createPrediction({
      ...BASE,
      probability: 0.7,
      agentCollected: true,
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

  it("不给概率（未量化，ADR-0011）⇒ 不创建 Forecast，且不是待背书", async () => {
    const result = await asOwner().createPrediction({ ...BASE })

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
      provenance: "AGENT_INSTRUCTED",
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
      { source: "https://example.com/evidence", rationale: "公告已发布" },
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
  })

  it("不给 decisionId 时 decisionId 落为 null，而不是 undefined", async () => {
    questionCreate.mockResolvedValue({ id: "q1" })

    await asOwner().createPrediction({ ...BASE })

    expect(decisionFindFirst).not.toHaveBeenCalled()
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
