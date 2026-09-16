import { tagsRouter } from "./tags_router"
import { QuestionType, Resolution } from "@prisma/client"
import prisma from "../prisma"

/**
 * 领域传播的自证用例（ADR-0030 §三/§四/§六）。
 *
 * §六 把话说明白了：两份数据（Decision 的领域、Question 的标签）之间**允许**有差异，
 * 且差异只由显式动作产生；一致性**不靠运行时不变量**，靠这里两条用例——
 *
 *   1. 挂接/补齐时传播确实发生；
 *   2. 事后改 Decision **不**污染已挂样本。
 *
 * 为什么值得单独写：去掉 `setDecisionDomains` 里的 `isRetag` 守卫，"顺手重标"会
 * 静默改写历史归属，而**不会有任何其它用例变红**。这一条就是那道守卫的全部价值。
 */

jest.mock("trpc-transformer", () => ({ __esModule: true, default: undefined }))

// tags_router 经 _utils_server 链到 node-fetch（ESM），jsdom 下拉不起来。
jest.mock("../_utils_server", () => ({
  __esModule: true,
  backendAnalyticsEvent: jest.fn(),
}))

jest.mock("../prisma", () => {
  const fake = {
    tag: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    decision: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    question: { findMany: jest.fn(), update: jest.fn() },
    revision: { create: jest.fn() },
  }
  return { __esModule: true, default: fake }
})

const tagFindMany = (prisma as unknown as { tag: { findMany: jest.Mock } }).tag
  .findMany
const tagFindFirst = (prisma as unknown as { tag: { findFirst: jest.Mock } })
  .tag.findFirst
const tagUpsert = (prisma as unknown as { tag: { upsert: jest.Mock } }).tag
  .upsert
const tagUpdate = (prisma as unknown as { tag: { update: jest.Mock } }).tag
  .update
const tagDelete = (prisma as unknown as { tag: { delete: jest.Mock } }).tag
  .delete
const decisionFindMany = (
  prisma as unknown as { decision: { findMany: jest.Mock } }
).decision.findMany
const decisionFindFirst = (
  prisma as unknown as { decision: { findFirst: jest.Mock } }
).decision.findFirst
const decisionFindUnique = (
  prisma as unknown as { decision: { findUnique: jest.Mock } }
).decision.findUnique
const decisionUpdate = (
  prisma as unknown as { decision: { update: jest.Mock } }
).decision.update
const questionFindMany = (
  prisma as unknown as { question: { findMany: jest.Mock } }
).question.findMany
const questionUpdate = (
  prisma as unknown as { question: { update: jest.Mock } }
).question.update
const revisionCreate = (
  prisma as unknown as { revision: { create: jest.Mock } }
).revision.create

type CallerInput = Parameters<typeof tagsRouter.createCaller>[0]

function asOwner() {
  return tagsRouter.createCaller({ userId: "user-1" } as CallerInput)
}

beforeEach(() => {
  jest.clearAllMocks()
  // 默认：决策没有任何领域（“补齐”那一支）。需要“重标”的用例自己覆盖。
  decisionFindUnique.mockResolvedValue({ tags: [] })
})

describe("领域传播（ADR-0030 §三/§四/§六）", () => {
  it("补齐（此前从未标过）：对新挂的和**已挂的**预测一并写入——这是补缺，不是改写", async () => {
    decisionFindFirst.mockResolvedValue({ id: "d1", tags: [] })
    tagFindMany.mockResolvedValue([
      { id: "t1", name: "投资/宏观", nameNormalized: "投资/宏观" },
    ])
    decisionUpdate.mockResolvedValue({ id: "d1" })
    questionFindMany.mockResolvedValue([{ id: "q1" }, { id: "q2" }])
    decisionFindUnique.mockResolvedValue({ tags: [{ id: "t1" }] })
    questionUpdate.mockResolvedValue({})

    const result = await asOwner().setDecisionDomains({
      decisionId: "d1",
      domains: ["投资/宏观"],
    })

    expect(result.backfilled).toBe(true)
    expect(questionUpdate).toHaveBeenCalledTimes(2)
    expect(questionUpdate).toHaveBeenCalledWith({
      where: { id: "q1" },
      data: { tags: { connect: [{ id: "t1" }] } },
    })
  })

  it("事后改 Decision 不污染历史：重标只改决策本身，已挂样本一个都不动", async () => {
    decisionFindFirst.mockResolvedValue({
      id: "d1",
      tags: [{ id: "t9", name: "投资/宏观" }],
    })
    tagFindMany.mockResolvedValue([
      {
        id: "t1",
        name: "投资/公司业绩-Q3",
        nameNormalized: "投资/公司业绩-q3",
      },
    ])
    decisionUpdate.mockResolvedValue({ id: "d1" })
    revisionCreate.mockResolvedValue({})

    const result = await asOwner().setDecisionDomains({
      decisionId: "d1",
      domains: ["投资/公司业绩-Q3"],
      reason: "原先标太粗",
    })

    // 补上这两个断言的意义：**去掉 isRetag 守卫，它们立刻变红**。
    expect(result.backfilled).toBe(false)
    expect(questionFindMany).not.toHaveBeenCalled()
    expect(questionUpdate).not.toHaveBeenCalled()
    // 留痕仍然发生（§五）：动作可以改历史口径，但必须被看见。
    expect(revisionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        decisionId: "d1",
        field: "tags",
        reason: "原先标太粗",
      }),
    })
  })

  it("重标不给理由 ⇒ 拒绝，且什么都不写（§五）", async () => {
    decisionFindFirst.mockResolvedValue({
      id: "d1",
      tags: [{ id: "t9", name: "投资/宏观" }],
    })
    tagFindMany.mockResolvedValue([
      {
        id: "t1",
        name: "投资/公司业绩-Q3",
        nameNormalized: "投资/公司业绩-q3",
      },
    ])

    await expect(
      asOwner().setDecisionDomains({
        decisionId: "d1",
        domains: ["投资/公司业绩-Q3"],
      }),
    ).rejects.toThrow(/必须给理由/)

    expect(decisionUpdate).not.toHaveBeenCalled()
    expect(questionUpdate).not.toHaveBeenCalled()
  })

  it("未知领域大声失败并给出词表指引，绝不静默造词（§七）", async () => {
    decisionFindFirst.mockResolvedValue({ id: "d1", tags: [] })
    // 第一次 findMany 是“按名字解析”，找不到；第二次是“把词表摆出来做指引”。
    tagFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ name: "投资/宏观" }])

    await expect(
      asOwner().setDecisionDomains({
        decisionId: "d1",
        domains: ["投资/物价"],
      }),
    ).rejects.toThrow(/投资\/物价/)

    expect(decisionUpdate).not.toHaveBeenCalled()
  })
})

/**
 * 标签/领域过程层的其余过程（ADR-0030 §十二/§十五）。
 *
 * 这一组守的是三类**没有症状**的失败：
 * 1. 判重键从 `nameNormalized_userId` 退回 `name_userId` ⇒ `CPI` 与 `cpi` 裂成两个桶，
 *    分桶曲线慢慢变得不可解释（没有任何报错）；
 * 2. 改名撞上已有领域却被放行 ⇒ 两个领域被顺手"合并"，历史归属无声漂移；
 * 3. 删除**有引用**的领域 ⇒ 改写历史归属；
 * 4. 读数把未背书/悬空/MCQ 样本算进去 ⇒ 技能分照样是个像模像样的数字。
 */
describe("标签与领域词表的过程层（ADR-0030）", () => {
  describe("setQuestionTags —— 判重折叠大小写", () => {
    it("按 nameNormalized 判重（CPI 与 cpi 落在同一个桶）—— 退回 name_userId 即变红", async () => {
      questionUpdate.mockResolvedValue({})
      tagFindMany.mockResolvedValue([])

      await asOwner().setQuestionTags({ questionId: "q1", tags: ["CPI"] })

      expect(questionUpdate).toHaveBeenCalledWith({
        where: { id: "q1" },
        data: {
          tags: {
            set: [],
            connectOrCreate: [
              {
                where: {
                  nameNormalized_userId: {
                    nameNormalized: "cpi",
                    userId: "user-1",
                  },
                },
                // 显示保留原样（"CPI"），判重才折叠
                create: {
                  name: "CPI",
                  nameNormalized: "cpi",
                  user: { connect: { id: "user-1" } },
                },
              },
            ],
          },
        },
      })
    })

    it("写完之后清掉零引用标签，避免词表长出没人用的词", async () => {
      questionUpdate.mockResolvedValue({})
      tagFindMany.mockResolvedValue([])
      const deleteMany = (
        prisma as unknown as { tag: { deleteMany: jest.Mock } }
      ).tag.deleteMany
      deleteMany.mockResolvedValue({})

      await asOwner().setQuestionTags({ questionId: "q1", tags: ["投资/宏观"] })

      expect(deleteMany).toHaveBeenCalledWith({
        where: { userId: "user-1", questions: { none: {} } },
      })
    })

    it("未登录 ⇒ 拒绝，且不写库", async () => {
      const anonymous = tagsRouter.createCaller({
        userId: undefined,
      } as CallerInput)

      await expect(
        anonymous.setQuestionTags({ questionId: "q1", tags: ["x"] }),
      ).rejects.toThrow(/logged in/)
      expect(questionUpdate).not.toHaveBeenCalled()
    })
  })

  describe("getAll / getByName —— 只在自己的词表里", () => {
    it("getAll 把引用计数摊平成 questionCount；未登录返回 null", async () => {
      tagFindMany.mockResolvedValue([
        { id: "t1", name: "投资/宏观", _count: { questions: 3 } },
      ])

      const result = await asOwner().getAll()

      expect(result).toEqual([
        expect.objectContaining({ id: "t1", questionCount: 3 }),
      ])
      expect(tagFindMany).toHaveBeenCalledWith({
        where: { userId: "user-1" },
        include: { _count: { select: { questions: true } } },
      })

      const anonymous = tagsRouter.createCaller({
        userId: undefined,
      } as CallerInput)
      expect(await anonymous.getAll()).toBeNull()
    })

    it("getByName 查不到就返回 null，而不是造一个", async () => {
      tagFindMany.mockResolvedValueOnce([])

      expect(await asOwner().getByName({ tagName: "投资/不存在" })).toBeNull()
      expect(tagFindMany).toHaveBeenCalledWith({
        where: { name: "投资/不存在", userId: "user-1" },
      })
    })
  })

  describe("addDomain —— 唯一的造词入口（§七）", () => {
    it("幂等：unique 键用 nameNormalized，已存在就返回那一个", async () => {
      tagUpsert.mockResolvedValue({ id: "t1", name: "投资/宏观" })

      const result = await asOwner().addDomain({ name: "投资/宏观" })

      expect(result).toEqual({ id: "t1", name: "投资/宏观" })
      expect(tagUpsert).toHaveBeenCalledWith({
        where: {
          nameNormalized_userId: {
            nameNormalized: "投资/宏观",
            userId: "user-1",
          },
        },
        update: {},
        create: {
          name: "投资/宏观",
          nameNormalized: "投资/宏观",
          userId: "user-1",
        },
      })
    })

    it("非法名字被拒绝，且一个字节都不写（不许静默清洗成别的词）", async () => {
      await expect(asOwner().addDomain({ name: "投资 宏观" })).rejects.toThrow(
        /空格/,
      )
      await expect(asOwner().addDomain({ name: "2026" })).rejects.toThrow(
        /非数字/,
      )
      expect(tagUpsert).not.toHaveBeenCalled()
    })
  })

  describe("renameDomain —— 改写历史归属必须留痕（§十五）", () => {
    it("每条受影响决策各留一条 Revision，并报出影响面", async () => {
      tagFindFirst
        .mockResolvedValueOnce({
          id: "t1",
          name: "投资/宏观",
          _count: { questions: 4, decisions: 2 },
        })
        .mockResolvedValueOnce(null)
      tagUpdate.mockResolvedValue({ id: "t1", name: "投资/宏观-v2" })
      decisionFindMany.mockResolvedValue([{ id: "d1" }, { id: "d2" }])
      revisionCreate.mockResolvedValue({})

      const result = await asOwner().renameDomain({
        from: "投资/宏观",
        to: "投资/宏观-v2",
        reason: "与 CPI 口径对齐",
      })

      expect(result).toEqual({
        id: "t1",
        name: "投资/宏观-v2",
        affectedDecisions: 2,
        affectedQuestions: 4,
      })
      expect(tagUpdate).toHaveBeenCalledWith({
        where: { id: "t1" },
        data: { name: "投资/宏观-v2", nameNormalized: "投资/宏观-v2" },
      })
      // 留痕是改名的全部合法性来源：不留痕就等于无声改写历史样本的归属
      expect(revisionCreate).toHaveBeenCalledTimes(2)
      expect(revisionCreate).toHaveBeenCalledWith({
        data: {
          decisionId: "d1",
          field: "tags",
          oldValue: "投资/宏观",
          newValue: "投资/宏观-v2",
          reason: "与 CPI 口径对齐",
        },
      })
    })

    it("撞上已有领域 ⇒ 拒绝（合并两个领域不是改名，去掉守卫即变红）", async () => {
      tagFindFirst
        .mockResolvedValueOnce({
          id: "t1",
          name: "投资/宏观",
          _count: { questions: 4, decisions: 2 },
        })
        .mockResolvedValueOnce({ id: "t2", name: "投资/公司业绩" })

      await expect(
        asOwner().renameDomain({
          from: "投资/宏观",
          to: "投资/公司业绩",
          reason: "看起来是一回事",
        }),
      ).rejects.toThrow(/已存在领域/)

      expect(tagUpdate).not.toHaveBeenCalled()
      expect(revisionCreate).not.toHaveBeenCalled()
    })

    it("改一个不存在的领域 ⇒ NOT_FOUND", async () => {
      tagFindFirst.mockResolvedValue(null)

      await expect(
        asOwner().renameDomain({ from: "无此领域", to: "x", reason: "y" }),
      ).rejects.toThrow(/找不到领域/)
      expect(tagUpdate).not.toHaveBeenCalled()
    })
  })

  describe("deleteDomain —— 只允许零引用（§十五）", () => {
    it("零引用 ⇒ 删除成功", async () => {
      tagFindFirst.mockResolvedValue({
        id: "t1",
        name: "投资/旧词",
        _count: { questions: 0, decisions: 0 },
      })
      tagDelete.mockResolvedValue({})

      expect(await asOwner().deleteDomain({ name: "投资/旧词" })).toEqual({
        deleted: "投资/旧词",
      })
      expect(tagDelete).toHaveBeenCalledWith({ where: { id: "t1" } })
    })

    it("有引用 ⇒ 拒绝，且不删（去掉守卫即变红）", async () => {
      tagFindFirst.mockResolvedValue({
        id: "t1",
        name: "投资/宏观",
        _count: { questions: 3, decisions: 1 },
      })

      await expect(
        asOwner().deleteDomain({ name: "投资/宏观" }),
      ).rejects.toThrow(/静默改写历史/)
      expect(tagDelete).not.toHaveBeenCalled()
    })

    it("删一个不存在的领域 ⇒ NOT_FOUND", async () => {
      tagFindFirst.mockResolvedValue(null)

      await expect(
        asOwner().deleteDomain({ name: "无此领域" }),
      ).rejects.toThrow(/找不到领域/)
      expect(tagDelete).not.toHaveBeenCalled()
    })
  })

  describe("domainReport —— 样本装配（读数错了没有症状，所以逐条钉）", () => {
    const reportedQuestion = (over: Record<string, unknown> = {}) => ({
      id: "q1",
      resolved: true,
      resolution: Resolution.YES,
      resolutionSource: "https://example.org/evidence",
      confirmedByUserId: "user-1",
      forecasts: [{ forecast: 0.8 }],
      ...over,
    })

    it("只取已背书预测、只取二元题、前缀含后代、悬空进分母不进判据", async () => {
      questionFindMany.mockResolvedValue([
        reportedQuestion({ id: "q1" }),
        reportedQuestion({ id: "q2", resolution: Resolution.NO }),
        // 悬空：已结算、无来源、由他人确认 ⇒ 进 pending，不进 n
        reportedQuestion({
          id: "q3",
          resolutionSource: null,
          confirmedByUserId: "someone-else",
        }),
      ])

      const report = await asOwner().domainReport({ prefix: "投资/CPI" })

      expect(report.n).toBe(2)
      expect(report.pending).toBe(1)
      expect(report.includesDescendants).toBe(true)

      // 查询本身必须表达这些规则：只靠输入样例的形状会把"忘过滤"掩盖过去
      const args = questionFindMany.mock.calls[0][0]
      expect(args.where.type).toBe(QuestionType.BINARY) // MCQ 不进读数
      expect(args.where.resolved).toBe(true)
      expect(args.where.resolution.in).toEqual([Resolution.YES, Resolution.NO])
      // 折叠大小写地比前缀，且**包含后代**（ADR-0030 §十一/§十三）
      expect(args.where.tags.some.OR).toEqual([
        { nameNormalized: "投资/cpi" },
        { nameNormalized: { startsWith: "投资/cpi/" } },
      ])
      // 未背书的预测不算样本（ADR-0008）
      expect(args.select.forecasts.where).toEqual({
        userId: "user-1",
        endorsed: true,
      })
    })

    it("预测取该用户已背书预测的**均值**（与 _scoring.ts 对同一条题的口径一致）", async () => {
      questionFindMany.mockResolvedValue(
        Array.from({ length: 5 }, (_, index) =>
          reportedQuestion({
            id: `q${index}`,
            forecasts: [{ forecast: 0.4 }, { forecast: 0.6 }],
          }),
        ),
      )

      const report = await asOwner().domainReport({ prefix: "投资/宏观" })

      expect(report.n).toBe(5)
      // 每条题取均值 0.5，结果都是 YES ⇒ Brier = (0.5 - 1)² = 0.25
      expect(report.brier).toBeCloseTo(0.25, 10)
    })

    it("一条已背书预测都没有 ⇒ 该题既不进样本也不进分母", async () => {
      questionFindMany.mockResolvedValue([reportedQuestion({ forecasts: [] })])

      const report = await asOwner().domainReport({ prefix: "投资/宏观" })

      expect(report.n).toBe(0)
      expect(report.pending).toBe(0)
    })

    it("n ≥ 5 只给形状：有桶、有 Brier，但不给技能分与区间（阈值以下字段不出现）", async () => {
      questionFindMany.mockResolvedValue(
        Array.from({ length: 6 }, (_, index) =>
          reportedQuestion({ id: `q${index}` }),
        ),
      )

      const report = await asOwner().domainReport({ prefix: "投资/宏观" })

      expect(report.n).toBe(6)
      expect(report.bins).toHaveLength(10)
      expect(report.brier).toBeDefined()
      expect(report.skillScore).toBeUndefined()
      expect(report.ci).toBeUndefined()
      expect(report.verdict).toBeUndefined()
    })
  })

  describe("listUntaggedDecisions —— 「没打标签」与「没有这条决策」要能区分（§八）", () => {
    it("按 tags: none 查，默认 50 条", async () => {
      decisionFindMany.mockResolvedValue([])

      await asOwner().listUntaggedDecisions({})

      expect(decisionFindMany).toHaveBeenCalledWith({
        where: { userId: "user-1", tags: { none: {} } },
        select: { id: true, statement: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 50,
      })
    })

    it("limit 被透传，且被 schema 限制在 200 以内（不许一次拉全库）", async () => {
      decisionFindMany.mockResolvedValue([])

      await asOwner().listUntaggedDecisions({ limit: 5 })
      expect(decisionFindMany.mock.calls[0][0].take).toBe(5)

      await expect(
        asOwner().listUntaggedDecisions({ limit: 1000 }),
      ).rejects.toThrow()
    })
  })
})
