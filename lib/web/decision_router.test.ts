import { decisionRouter } from "./decision_router"
import { CURRENT_RUBRIC_VERSION } from "./decision_rubric"
import prisma from "../prisma"

// trpc-transformer 经 superjson 是 ESM，jsdom 下加载不了；直接调用过程不需要序列化。
jest.mock("trpc-transformer", () => ({ __esModule: true, default: undefined }))

jest.mock("../prisma", () => {
  const fake = {
    decision: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      // 挂接预测时的写时复制（ADR-0030 §三）会读决策的领域；默认给“无领域”，
      // 于是复制是空动作，不干扰既有断言（它们关心的是清单与锁定）。
      findUnique: jest.fn().mockResolvedValue({ tags: [] }),
    },
    decisionRubricEntry: { upsert: jest.fn(), findMany: jest.fn() },
    question: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    revision: { createMany: jest.fn() },
    $transaction: jest.fn(),
  }
  // ADR-0012：快照 → 留痕 → 更新必须同事务。测试里让事务直接执行回调，并把同一个
  // 假客户端当作 tx 传进去——Prisma 的语义正是"回调收到一个事务客户端"。
  fake.$transaction.mockImplementation((callback: (tx: unknown) => unknown) =>
    callback(fake),
  )
  return { __esModule: true, default: fake }
})

const decisionCreate = (
  prisma as unknown as { decision: { create: jest.Mock } }
).decision.create
const decisionFindFirst = (
  prisma as unknown as { decision: { findFirst: jest.Mock } }
).decision.findFirst
const decisionFindUnique = (
  prisma as unknown as { decision: { findUnique: jest.Mock } }
).decision.findUnique
const rubricUpsert = (
  prisma as unknown as { decisionRubricEntry: { upsert: jest.Mock } }
).decisionRubricEntry.upsert
const rubricFindMany = (
  prisma as unknown as { decisionRubricEntry: { findMany: jest.Mock } }
).decisionRubricEntry.findMany
const questionFindFirst = (
  prisma as unknown as { question: { findFirst: jest.Mock } }
).question.findFirst
const questionFindMany = (
  prisma as unknown as { question: { findMany: jest.Mock } }
).question.findMany
const questionUpdate = (
  prisma as unknown as { question: { update: jest.Mock } }
).question.update
const decisionUpdate = (
  prisma as unknown as { decision: { update: jest.Mock } }
).decision.update
const decisionFindMany = (
  prisma as unknown as { decision: { findMany: jest.Mock } }
).decision.findMany
const revisionCreateMany = (
  prisma as unknown as { revision: { createMany: jest.Mock } }
).revision.createMany

type CallerInput = Parameters<typeof decisionRouter.createCaller>[0]

const asOwner = () =>
  decisionRouter.createCaller({ userId: "user-1" } as CallerInput)

/**
 * 决策的默认形状，**与 Prisma 实际返回的字段一致**。缺字段的 mock 会让
 * `decision.rubricRecordedAfterOutcomeAt === null` 这类判断静默走进另一条分支
 * （`undefined !== null`），于是测试绿而生产跑的是另一条路。
 */
function decisionFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "d1",
    statement: "接这个 offer",
    reasoning: null,
    expectedOutcome: null,
    knownInfo: null,
    unknownInfo: null,
    rubricVersion: 1,
    rubricLockedAt: null,
    rubricRecordedAfterOutcomeAt: null,
    ...overrides,
  }
}

// 默认：该决策下还没有任何 Prediction，因此清单可写（需要锁定的用例自行覆盖）
beforeEach(() => {
  questionFindMany.mockResolvedValue([])
})

describe("decision.create（ADR-0019 · ticket 01）", () => {
  it("陈述必填：空白陈述被拒，且不落库", async () => {
    await expect(asOwner().create({ statement: "   " })).rejects.toThrow(/陈述/)

    expect(decisionCreate).not.toHaveBeenCalled()
  })

  it("落库的是归一化后的叙事，并归属当前 owner", async () => {
    decisionCreate.mockResolvedValue({ id: "d1" })

    const result = await asOwner().create({
      statement: "  接这个 offer ",
      reasoning: "",
      knownInfo: " 团队刚融资 ",
    })

    expect(decisionCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        statement: "接这个 offer",
        reasoning: null,
        expectedOutcome: null,
        knownInfo: "团队刚融资",
        unknownInfo: null,
        // ADR-0020 第四点：新建的决策记下所属决策版本，否则它没有可解释的
        // 条目集合（而回退到"当前版本"就是静默改写历史）
        rubricVersion: CURRENT_RUBRIC_VERSION,
      },
    })
    expect(result).toEqual({ id: "d1" })
  })
})

describe("decision.byId（ADR-0019 · ticket 01）", () => {
  it("只能读自己的决策：属主写进查询条件，而不是取回后再判", async () => {
    decisionFindFirst.mockResolvedValue({
      id: "d1",
      rubricVersion: 1,
      statement: "换个城市",
      rubricEntries: [],
      questions: [],
    })

    await asOwner().byId({ decisionId: "d1" })

    expect(decisionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "d1", userId: "user-1" } }),
    )
  })

  it("别人的决策与不存在的决策一样 → NOT_FOUND（不泄露存在性）", async () => {
    decisionFindFirst.mockResolvedValue(null)

    await expect(asOwner().byId({ decisionId: "d1" })).rejects.toThrow(
      /找不到该决策/,
    )
  })
})

describe("decision.byId 的结算处境标签（ADR-0031 §二/§三）", () => {
  const withQuestion = (question: Record<string, unknown>) =>
    decisionFindFirst.mockResolvedValue({
      id: "d1",
      rubricVersion: 1,
      statement: "换个城市",
      rubricEntries: [],
      questions: [
        {
          id: "q1",
          title: "命题",
          resolved: true,
          resolutionSource: null,
          confirmedByUserId: "user-2",
          questionScores: [],
          ...question,
        },
      ],
    })

  it("悬空 ⇒ DANGLING，且带上 §二 的显示名（不是看起来像没这条预测）", async () => {
    withQuestion({})

    const detail = await asOwner().byId({ decisionId: "d1" })

    expect(detail.questions[0].settlementScope).toBe("DANGLING")
    expect(detail.questions[0].settlementLabel).toBe("未结算（无可核查来源）")
  })

  it("有来源 + 他方确认 ⇒ 生效，但仍标出“不是我签的字”（§三）", async () => {
    withQuestion({ resolutionSource: "https://data.example.org/cpi" })

    const detail = await asOwner().byId({ decisionId: "d1" })

    expect(detail.questions[0].settlementScope).toBe("EFFECTIVE")
    expect(detail.questions[0].settlementLabel).toBe("由他方确认结算")
  })

  it("本人确认且无来源 ⇒ 生效，不挂标签", async () => {
    withQuestion({ confirmedByUserId: "user-1" })

    const detail = await asOwner().byId({ decisionId: "d1" })

    expect(detail.questions[0].settlementScope).toBe("EFFECTIVE")
    expect(detail.questions[0].settlementLabel).toBeNull()
  })

  it("还没结算 ⇒ UNRESOLVED，不挂标签（悬空不能由“还没结算”产生）", async () => {
    withQuestion({ resolved: false })

    const detail = await asOwner().byId({ decisionId: "d1" })

    expect(detail.questions[0].settlementScope).toBe("UNRESOLVED")
    expect(detail.questions[0].settlementLabel).toBeNull()
  })
})

describe("decision.setRubric（ADR-0016 / ADR-0020 · ticket 02）", () => {
  it("未知条目被拒，且不写库——库里不能出现集合外的清单项", async () => {
    decisionFindFirst.mockResolvedValue(decisionFixture())

    await expect(
      asOwner().setRubric({
        decisionId: "d1",
        entries: [{ itemKey: "notAThing", status: "DONE" }],
      }),
    ).rejects.toThrow(/未知清单条目/)

    expect(rubricUpsert).not.toHaveBeenCalled()
  })

  it("别人的决策写不进去", async () => {
    decisionFindFirst.mockResolvedValue(null)

    await expect(
      asOwner().setRubric({
        decisionId: "d1",
        entries: [{ itemKey: "alternatives", status: "DONE" }],
      }),
    ).rejects.toThrow(/找不到该决策/)

    expect(rubricUpsert).not.toHaveBeenCalled()
  })

  it("返回的是整个决策的完成度，而不是本次提交了几条", async () => {
    decisionFindFirst.mockResolvedValue(decisionFixture())
    rubricFindMany.mockResolvedValue([
      { itemKey: "alternatives", status: "DONE" },
      { itemKey: "premortem", status: "DONE" },
      { itemKey: "baseRate", status: "DONE" },
    ])

    const completion = await asOwner().setRubric({
      decisionId: "d1",
      entries: [{ itemKey: "alternatives", status: "DONE" }],
    })

    expect(rubricUpsert).toHaveBeenCalledWith({
      where: {
        decisionId_itemKey: { decisionId: "d1", itemKey: "alternatives" },
      },
      create: {
        decisionId: "d1",
        itemKey: "alternatives",
        status: "DONE",
      },
      update: { status: "DONE" },
    })
    expect(completion).toEqual({
      done: 3,
      total: 5,
      missing: ["whatIfWrong", "falsifiableCriteria"],
    })
  })
})

describe("decision.byId 的清单完成度（ticket 02）", () => {
  it("完成度由记录推导出来，而不是存下来的一个数", async () => {
    decisionFindFirst.mockResolvedValue({
      id: "d1",
      rubricVersion: 1,
      statement: "接 offer",
      rubricEntries: [
        { itemKey: "alternatives", status: "DONE" },
        { itemKey: "premortem", status: "NOT_DONE" },
      ],
      questions: [],
    })

    const detail = await asOwner().byId({ decisionId: "d1" })

    expect(detail.rubric).toEqual({
      done: 1,
      total: 5,
      missing: ["premortem", "baseRate", "whatIfWrong", "falsifiableCriteria"],
    })
    expect(detail.rubricEntries).toHaveLength(2)
  })

  it("返回挂着的 Prediction——就是复盘要看的「结果侧」", async () => {
    decisionFindFirst.mockResolvedValue({
      id: "d1",
      rubricVersion: 1,
      statement: "接 offer",
      rubricEntries: [],
      questions: [
        {
          id: "q1",
          title: "6 月底前收到 offer",
          resolved: true,
          questionScores: [],
        },
      ],
    })

    const detail = await asOwner().byId({ decisionId: "d1" })

    expect(detail.questions).toHaveLength(1)
    // 分数只取**本人**的：同一条题可能有多个预测者，而复盘是当事人自己看的
    expect(decisionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          questions: expect.objectContaining({
            include: { questionScores: { where: { userId: "user-1" } } },
          }),
        }),
      }),
    )
  })

  it("逐条分数取 QuestionScore 已存值：相对分为 null 即不参与相对分（US16）", async () => {
    const num = (value: number) => ({ toNumber: () => value })
    decisionFindFirst.mockResolvedValue({
      ...decisionFixture(),
      statement: "接 offer",
      rubricEntries: [],
      questions: [
        {
          id: "q1",
          title: "公共事实类",
          resolved: true,
          questionScores: [
            { absoluteScore: num(0.12), relativeScore: num(0.03) },
          ],
        },
        {
          id: "q2",
          title: "自评类",
          resolved: true,
          questionScores: [{ absoluteScore: num(0.4), relativeScore: null }],
        },
        { id: "q3", title: "还没结算", resolved: false, questionScores: [] },
      ],
    })

    const detail = await asOwner().byId({ decisionId: "d1" })

    // 未结算 ⇒ `null`（没有分数行），而不是 0 分
    expect(detail.questions.map((question) => question.score)).toEqual([
      { absolute: 0.12, relative: 0.03 },
      { absolute: 0.4, relative: null },
      null,
    ])
  })
})

describe("decision.list（ticket 06）", () => {
  it("列表同时给出质量侧与结果侧，且两者不揉成一个数", async () => {
    decisionFindMany.mockResolvedValue([
      {
        id: "d1",
        statement: "接 offer",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        rubricVersion: 1,
        rubricLockedAt: null,
        rubricEntries: [
          { itemKey: "alternatives", status: "DONE" },
          { itemKey: "baseRate", status: "DONE" },
        ],
        questions: [
          { id: "q1", title: "已揭晓", resolved: true },
          { id: "q2", title: "未揭晓", resolved: false },
        ],
      },
    ])

    const list = await asOwner().list({})

    expect(list).toEqual([
      expect.objectContaining({
        id: "d1",
        rubricVersion: 1,
        rubric: {
          done: 2,
          total: 5,
          missing: ["premortem", "whatIfWrong", "falsifiableCriteria"],
        },
        rubricLock: {
          locked: true,
          byPredictionId: "q1",
          byPredictionTitle: "已揭晓",
          lockedAt: null,
        },
        predictions: { total: 2, resolved: 1 },
      }),
    ])
  })

  it("只看自己的决策，且按时间倒序取有限条", async () => {
    decisionFindMany.mockResolvedValue([])

    await asOwner().list({ limit: 5 })

    expect(decisionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1" },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    )
  })
})

describe("鉴权：未解析到 owner 时必须当场拒绝（ADR-0015）", () => {
  it("匿名调用任何决策过程都是 UNAUTHORIZED，不触达数据库", async () => {
    // 这一条不是多余的形式：属主边界写在 where 里（`{ id, userId }`），而 Prisma 会把
    // `userId: undefined` 当作"不过滤"——少了这道 guard，匿名请求读到的就是所有人的决策。
    const anonymous = () =>
      decisionRouter.createCaller({ userId: undefined } as CallerInput)

    await expect(anonymous().list({})).rejects.toThrow(/未解析到 owner/)
    await expect(anonymous().byId({ decisionId: "d1" })).rejects.toThrow(
      /未解析到 owner/,
    )
    await expect(anonymous().create({ statement: "x" })).rejects.toThrow(
      /未解析到 owner/,
    )

    expect(decisionFindMany).not.toHaveBeenCalled()
    expect(decisionFindFirst).not.toHaveBeenCalled()
    expect(decisionCreate).not.toHaveBeenCalled()
  })
})

describe("decision.attachPrediction（ADR-0019 · ticket 03）", () => {
  it("挂接时把决策**当时**的领域复制到预测上（ADR-0030 §三 自证：去掉传播即变红）", async () => {
    decisionFindFirst.mockResolvedValue(decisionFixture())
    questionFindFirst.mockResolvedValue({ id: "q1", decisionId: null })
    questionUpdate.mockResolvedValue({ id: "q1", decisionId: "d1" })
    // 决策此刻有领域 ⇒ 挂接必须把它们写到预测上，且只做并集（connect，不是 set）：
    // 预测本可以有自己的标签（上游按题标签），领域是叠加的一层，不是覆盖它。
    decisionFindUnique.mockResolvedValue({ tags: [{ id: "t1" }, { id: "t2" }] })

    await asOwner().attachPrediction({ decisionId: "d1", questionId: "q1" })

    expect(questionUpdate).toHaveBeenLastCalledWith({
      where: { id: "q1" },
      data: { tags: { connect: [{ id: "t1" }, { id: "t2" }] } },
    })
  })

  it("决策没有领域时，挂接不做多余的一次写", async () => {
    decisionFindFirst.mockResolvedValue(decisionFixture())
    questionFindFirst.mockResolvedValue({ id: "q1", decisionId: null })
    questionUpdate.mockResolvedValue({ id: "q1", decisionId: "d1" })
    decisionFindUnique.mockResolvedValue({ tags: [] })

    await asOwner().attachPrediction({ decisionId: "d1", questionId: "q1" })

    expect(questionUpdate).toHaveBeenCalledTimes(1)
  })

  it("把已有 Prediction 挂到决策上", async () => {
    decisionFindFirst.mockResolvedValue(decisionFixture())
    questionFindFirst.mockResolvedValue({ id: "q1", decisionId: null })
    questionUpdate.mockResolvedValue({ id: "q1", decisionId: "d1" })

    await asOwner().attachPrediction({ decisionId: "d1", questionId: "q1" })

    expect(questionUpdate).toHaveBeenCalledWith({
      where: { id: "q1" },
      data: { decisionId: "d1" },
    })
  })

  it("只能挂自己的 Prediction：属主写进查询条件", async () => {
    decisionFindFirst.mockResolvedValue(decisionFixture())
    questionFindFirst.mockResolvedValue(null)

    await expect(
      asOwner().attachPrediction({ decisionId: "d1", questionId: "q1" }),
    ).rejects.toThrow(/找不到该预测/)

    expect(questionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "q1", userId: "user-1" } }),
    )
    expect(questionUpdate).not.toHaveBeenCalled()
  })

  it("已属另一个决策 → 拒绝，且不改动归属", async () => {
    decisionFindFirst.mockResolvedValue(decisionFixture())
    questionFindFirst.mockResolvedValue({ id: "q1", decisionId: "d2" })

    await expect(
      asOwner().attachPrediction({ decisionId: "d1", questionId: "q1" }),
    ).rejects.toThrow(/至多属一个 Decision/)

    expect(questionUpdate).not.toHaveBeenCalled()
  })

  it("重复挂到同一个决策是幂等的，不报错", async () => {
    decisionFindFirst.mockResolvedValue(decisionFixture())
    questionFindFirst.mockResolvedValue({ id: "q1", decisionId: "d1" })
    questionUpdate.mockResolvedValue({ id: "q1", decisionId: "d1" })

    await asOwner().attachPrediction({ decisionId: "d1", questionId: "q1" })

    expect(questionUpdate).toHaveBeenCalled()
  })
  it("先建决策、补清单，再挂上一条已结算的 Prediction ⇒ 标记「结果揭晓后记录」", async () => {
    decisionFindFirst.mockResolvedValue(decisionFixture())
    questionFindFirst.mockResolvedValue({
      id: "q1",
      decisionId: null,
      resolved: true,
      resolvedAt: new Date("2026-01-02T00:00:00Z"),
    })
    questionUpdate.mockResolvedValue({ id: "q1", decisionId: "d1" })
    rubricFindMany.mockResolvedValue([
      { itemKey: "premortem", recordedAt: new Date("2026-01-03T00:00:00Z") },
    ])

    await asOwner().attachPrediction({ decisionId: "d1", questionId: "q1" })

    expect(decisionUpdate).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: {
        rubricRecordedAfterOutcomeAt: new Date("2026-01-03T00:00:00Z"),
      },
    })
  })

  it("清单写在结算之前 ⇒ 不打标记：那确实是决策当时写的", async () => {
    decisionFindFirst.mockResolvedValue(decisionFixture())
    questionFindFirst.mockResolvedValue({
      id: "q1",
      decisionId: null,
      resolved: true,
      resolvedAt: new Date("2026-01-02T00:00:00Z"),
    })
    questionUpdate.mockResolvedValue({ id: "q1", decisionId: "d1" })
    rubricFindMany.mockResolvedValue([
      { itemKey: "premortem", recordedAt: new Date("2026-01-01T00:00:00Z") },
    ])

    await asOwner().attachPrediction({ decisionId: "d1", questionId: "q1" })

    // 只写了一件事：锁定时点。没有任何“结果揭晓后记录”的标记
    expect(decisionUpdate).toHaveBeenCalledTimes(1)
    expect(decisionUpdate).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: { rubricLockedAt: expect.any(Date) },
    })
  })

  it("未结算的 Prediction 不触发标记：那时还没有“结果”", async () => {
    decisionFindFirst.mockResolvedValue(decisionFixture())
    questionFindFirst.mockResolvedValue({
      id: "q1",
      decisionId: null,
      resolved: false,
      resolvedAt: null,
    })
    questionUpdate.mockResolvedValue({ id: "q1", decisionId: "d1" })

    await asOwner().attachPrediction({ decisionId: "d1", questionId: "q1" })

    expect(rubricFindMany).not.toHaveBeenCalled()
    expect(decisionUpdate).not.toHaveBeenCalled()
  })
})

describe("decision.detachPrediction（ticket 03）", () => {
  it("解绑是置空归属，而不是删掉预测", async () => {
    questionFindFirst.mockResolvedValue({
      id: "q1",
      title: "还没结算",
      decisionId: "d1",
      resolved: false,
    })
    questionUpdate.mockResolvedValue({ id: "q1", decisionId: null })

    await asOwner().detachPrediction({ questionId: "q1" })

    expect(questionUpdate).toHaveBeenCalledWith({
      where: { id: "q1" },
      data: { decisionId: null },
    })
  })

  it("不是自己的 Prediction → NOT_FOUND", async () => {
    questionFindFirst.mockResolvedValue(null)

    await expect(
      asOwner().detachPrediction({ questionId: "q1" }),
    ).rejects.toThrow(/找不到该预测/)

    expect(questionUpdate).not.toHaveBeenCalled()
  })
})

describe("锁定不可被解绑绕过（ADR-0020 · 回归）", () => {
  it("已结算的预测不能解绑：解绑会让清单重新可写", async () => {
    questionFindFirst.mockResolvedValue({
      id: "q1",
      title: "6 月底前收到 offer",
      decisionId: "d1",
      resolved: true,
    })

    await expect(
      asOwner().detachPrediction({ questionId: "q1" }),
    ).rejects.toThrow(/已结算，不能解绑/)

    // 拒绝是真的拒绝：归属一行都没动，因此锁定判据仍看得见这条已结算的预测
    expect(questionUpdate).not.toHaveBeenCalled()
  })

  it("结算被撤销后清单仍不可写：只看事实的实现会在这里重新开门", async () => {
    // 事实侧已经消失——`undoQuestionResolution` 把 `resolved` 置回 false：
    // 这也是 ADR-0020 要把已记录的时点并进判据的唯一理由。
    decisionFindFirst.mockResolvedValue(
      decisionFixture({ rubricLockedAt: new Date("2026-01-01T00:00:00Z") }),
    )
    questionFindMany.mockResolvedValue([
      { id: "q1", title: "6 月底前收到 offer", resolved: false },
    ])

    await expect(
      asOwner().setRubric({ decisionId: "d1", entries: [] }),
    ).rejects.toThrow(/已被撤销/)

    // 时点已经记过，不重复写；一行清单都没落库
    expect(decisionUpdate).not.toHaveBeenCalled()
    expect(rubricUpsert).not.toHaveBeenCalled()
  })

  it("未结算的预测即使所在决策已锁定，也可解绑：锁由已记录的时点保持，不靠挂着谁", () => {
    // 判据只看这条预测自己的 `resolved`：锁不靠"还挂着哪条预测"，因此解绑一条
    // 未结算的预测不可能把门重新打开（这正是加进 rubricLockedAt 的代价换来的自由）
    questionFindFirst.mockResolvedValue({
      id: "q2",
      title: "还没结算",
      decisionId: "d1",
      resolved: false,
    })
    questionUpdate.mockResolvedValue({ id: "q2", decisionId: null })

    return asOwner()
      .detachPrediction({ questionId: "q2" })
      .then(() => {
        expect(questionUpdate).toHaveBeenCalledWith({
          where: { id: "q2" },
          data: { decisionId: null },
        })
      })
  })

  it("锁定之后，解绑请求被拒 → 清单依旧写不进去（原漏洞的端到端形式）", async () => {
    decisionFindFirst.mockResolvedValue(decisionFixture())
    questionFindMany.mockResolvedValue([
      { id: "q1", title: "已结算", resolved: true },
    ])
    questionFindFirst.mockResolvedValue({
      id: "q1",
      title: "已结算",
      decisionId: "d1",
      resolved: true,
    })

    await expect(
      asOwner().detachPrediction({ questionId: "q1" }),
    ).rejects.toThrow(/已结算，不能解绑/)

    await expect(
      asOwner().setRubric({
        decisionId: "d1",
        entries: [{ itemKey: "alternatives", status: "DONE" }],
      }),
    ).rejects.toThrow(/已锁定/)

    expect(rubricUpsert).not.toHaveBeenCalled()
  })

  it("挂上一条已结算的预测，立即记下锁定时点", async () => {
    decisionFindFirst.mockResolvedValue(decisionFixture())
    questionFindFirst.mockResolvedValue({
      id: "q1",
      title: "早就结算了",
      decisionId: null,
      resolved: true,
    })
    questionUpdate.mockResolvedValue({ id: "q1", decisionId: "d1" })

    await asOwner().attachPrediction({ decisionId: "d1", questionId: "q1" })

    expect(decisionUpdate).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: { rubricLockedAt: expect.any(Date) },
    })
  })

  it("挂上未结算的预测不写锁定时点（锁尚未开始）", async () => {
    decisionFindFirst.mockResolvedValue(decisionFixture())
    questionFindFirst.mockResolvedValue({
      id: "q1",
      title: "还没结算",
      decisionId: null,
      resolved: false,
    })
    questionUpdate.mockResolvedValue({ id: "q1", decisionId: "d1" })

    await asOwner().attachPrediction({ decisionId: "d1", questionId: "q1" })

    expect(decisionUpdate).not.toHaveBeenCalled()
  })
})

describe("decision.setRubric 的锁定（ADR-0020 · ticket 04）", () => {
  it("没有任何已结算的 Prediction 时可以写清单", async () => {
    decisionFindFirst.mockResolvedValue(decisionFixture())
    rubricFindMany.mockResolvedValue([
      { itemKey: "alternatives", status: "DONE" },
    ])

    await asOwner().setRubric({
      decisionId: "d1",
      entries: [{ itemKey: "alternatives", status: "DONE" }],
    })

    expect(rubricUpsert).toHaveBeenCalled()
    expect(decisionUpdate).not.toHaveBeenCalled()
  })

  it("任一 Prediction 已结算 ⇒ 拒绝写入，并指出是哪条关上了这扇门", async () => {
    decisionFindFirst.mockResolvedValue(decisionFixture())
    questionFindMany.mockResolvedValue([
      { id: "q1", title: "还没结算", resolved: false },
      { id: "q2", title: "6 月底前收到 offer", resolved: true },
    ])

    await expect(
      asOwner().setRubric({
        decisionId: "d1",
        entries: [{ itemKey: "alternatives", status: "DONE" }],
      }),
    ).rejects.toThrow(/6 月底前收到 offer/)

    // 拒绝是真的拒绝：清单一行都没被动
    expect(rubricUpsert).not.toHaveBeenCalled()
  })

  it("首次察觉锁定就记下时点；已记过则不再写（锁单向，不回退）", async () => {
    decisionFindFirst.mockResolvedValue(decisionFixture())
    questionFindMany.mockResolvedValue([
      { id: "q2", title: "已结算", resolved: true },
    ])

    await expect(
      asOwner().setRubric({ decisionId: "d1", entries: [] }),
    ).rejects.toThrow(/已锁定/)

    expect(decisionUpdate).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: { rubricLockedAt: expect.any(Date) },
    })

    decisionUpdate.mockClear()
    decisionFindFirst.mockResolvedValue(
      decisionFixture({ rubricLockedAt: new Date("2026-01-01T00:00:00Z") }),
    )

    await expect(
      asOwner().setRubric({ decisionId: "d1", entries: [] }),
    ).rejects.toThrow(/已锁定/)

    expect(decisionUpdate).not.toHaveBeenCalled()
  })
})

describe("叙事：补写自由，改写必须带理由并留痕（ADR-0012 · ticket 13）", () => {
  it("给空白字段补写：不要理由，也不留修订记录", async () => {
    decisionFindFirst.mockResolvedValue(decisionFixture())
    decisionUpdate.mockResolvedValue(decisionFixture())

    await asOwner().updateNarrative({
      decisionId: "d1",
      unknownInfo: "当时不知道团队会不会被收购",
    })

    expect(revisionCreateMany).not.toHaveBeenCalled()
    expect(decisionUpdate).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: { unknownInfo: "当时不知道团队会不会被收购" },
    })
  })

  it("改写已填写内容：没有理由即拒绝，且什么都不写", async () => {
    decisionFindFirst.mockResolvedValue(
      decisionFixture({ reasoning: "当时觉得团队靠谱" }),
    )

    await expect(
      asOwner().updateNarrative({
        decisionId: "d1",
        reasoning: "当时觉得团队一般",
      }),
    ).rejects.toThrow(/必须给出理由/)

    expect(revisionCreateMany).not.toHaveBeenCalled()
    expect(decisionUpdate).not.toHaveBeenCalled()
  })

  it("改写带理由 ⇒ 落一条修订：旧值 / 新值 / 理由都在", async () => {
    decisionFindFirst.mockResolvedValue(
      decisionFixture({ reasoning: "当时觉得团队靠谱" }),
    )
    decisionUpdate.mockResolvedValue(decisionFixture())

    await asOwner().updateNarrative({
      decisionId: "d1",
      reasoning: "当时觉得团队一般",
      reason: "复盘时发现当初把因果关系写反了",
    })

    expect(revisionCreateMany).toHaveBeenCalledWith({
      data: [
        {
          decisionId: "d1",
          field: "reasoning",
          oldValue: "当时觉得团队靠谱",
          newValue: "当时觉得团队一般",
          reason: "复盘时发现当初把因果关系写反了",
        },
      ],
    })
  })

  it("清空已填写内容也算改写：同样要理由（留痕里新值为 null）", async () => {
    decisionFindFirst.mockResolvedValue(
      decisionFixture({ knownInfo: "赛道里有一个直接竞品" }),
    )
    decisionUpdate.mockResolvedValue(decisionFixture())

    await expect(
      asOwner().updateNarrative({ decisionId: "d1", knownInfo: "" }),
    ).rejects.toThrow(/必须给出理由/)

    await asOwner().updateNarrative({
      decisionId: "d1",
      knownInfo: "",
      reason: "那条竞品信息后来证实是错的",
    })

    expect(decisionUpdate).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: { knownInfo: null },
    })
    expect(revisionCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          field: "knownInfo",
          newValue: null,
        }),
      ],
    })
  })

  it("局部更新：没提到的字段保持原值，而不是被顺手清空", async () => {
    decisionFindFirst.mockResolvedValue(
      decisionFixture({ reasoning: "理由", knownInfo: "当时已知" }),
    )
    decisionUpdate.mockResolvedValue(decisionFixture())

    await asOwner().updateNarrative({
      decisionId: "d1",
      unknownInfo: "当时不知道的",
    })

    // `data` 里只有被提到的字段。否则"改一句"会顺手抹掉另外四栏，
    // 而抹掉是改写，本应带理由留痕。
    expect(decisionUpdate).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: { unknownInfo: "当时不知道的" },
    })
  })

  it("空白陈述被拒：决策必须说清它在决定什么", async () => {
    decisionFindFirst.mockResolvedValue(decisionFixture())

    await expect(
      asOwner().updateNarrative({ decisionId: "d1", statement: "   " }),
    ).rejects.toThrow(/陈述不能为空/)

    expect(decisionUpdate).not.toHaveBeenCalled()
  })
})

describe("锁定只作用于清单：叙事仍可补充（ADR-0020 · ticket 04）", () => {
  it("清单被锁之后，叙事照样改得动", async () => {
    decisionFindFirst.mockResolvedValue(decisionFixture())
    questionFindMany.mockResolvedValue([
      { id: "q2", title: "已结算", resolved: true },
    ])
    decisionUpdate.mockResolvedValue(decisionFixture())

    await expect(
      asOwner().setRubric({
        decisionId: "d1",
        entries: [{ itemKey: "alternatives", status: "DONE" }],
      }),
    ).rejects.toThrow(/已锁定/)

    // 同一个决策，叙事仍写得进去——锁定不是把整个决策冻结
    await asOwner().updateNarrative({
      decisionId: "d1",
      statement: "接这个 offer",
      unknownInfo: "当时不知道团队会不会被收购",
    })

    expect(decisionUpdate).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: expect.objectContaining({
        statement: "接这个 offer",
        unknownInfo: "当时不知道团队会不会被收购",
      }),
    })
  })

  it("叙事写入同样受属主边界约束", async () => {
    decisionFindFirst.mockResolvedValue(null)

    await expect(
      asOwner().updateNarrative({ decisionId: "d1", statement: "x" }),
    ).rejects.toThrow(/找不到该决策/)
  })
})
