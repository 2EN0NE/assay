import {
  Forecast,
  Question,
  QuestionOption,
  QuestionType,
  Resolution,
} from "@prisma/client"
import { Prisma } from "@prisma/client"
import type { QuestionWithForecastsAndScores } from "../../prisma/additional"

// Avoid loading notifications -> _utils_server -> node-fetch (ESM) in jsdom
jest.mock("./notifications", () => ({
  createNotification: jest.fn(),
  sendEmailReadyToResolveNotification: jest.fn(),
  sendBatchedEmails: jest.fn(),
  sendEmailWithTemplateUnbatched: jest.fn(),
  sendEmailUnbatched: jest.fn(),
  assayEmailFooter: jest.fn(),
}))

// Avoid loading question_url -> trpc -> trpc-transformer -> superjson (ESM) in jsdom
jest.mock("./question_url", () => ({
  getQuestionUrl: jest.fn(),
  extractQuestionId: jest.fn(),
}))

jest.mock("../prisma", () => {
  const txStub = {
    question: { update: jest.fn() },
    questionOption: { updateMany: jest.fn() },
    questionScore: { deleteMany: jest.fn() },
  }
  return {
    __esModule: true,
    default: {
      question: { update: jest.fn(), delete: jest.fn(), findUnique: jest.fn() },
      questionOption: {
        update: jest.fn(),
        updateMany: jest.fn(),
        findMany: jest.fn(),
      },
      questionScore: { deleteMany: jest.fn(), upsert: jest.fn() },
      // ADR-0020 第五点：结算路径顺手写决策的锁定时点。这里是结果分的路径，
      // 刻意不 import 决策模块（`.eslintrc.json` 的 no-restricted-imports 守着）。
      decision: { updateMany: jest.fn() },
      $transaction: jest.fn((arg: unknown) => {
        if (Array.isArray(arg)) return Promise.all(arg)
        if (typeof arg === "function") {
          txStub.question.update.mockResolvedValue({ exclusiveAnswers: true })
          return arg(txStub)
        }
        return undefined
      }),
    },
  }
})

import prisma from "../prisma"
import {
  deleteQuestion,
  handleQuestionResolution,
  rescoreResolvedQuestion,
  scoreQuestion,
  scoreQuestionOptions,
  undoQuestionOptionResolution,
  undoQuestionResolution,
} from "./resolution"

const DAY = 24 * 60 * 60 * 1000

// 递增计数器而不是 Math.random()：测试输入应当可复现（同一 commit 跑两次得到同一组数据）。
let nextForecastId = 1

function makeForecast(
  userId: string,
  forecast: number,
  createdAt = new Date(0),
  endorsed = true,
): Forecast {
  return {
    id: nextForecastId++,
    createdAt,
    comment: null,
    forecast: new Prisma.Decimal(forecast),
    profileId: null,
    questionId: "q1",
    optionId: null,
    userId,
    // 人类录入的预测默认已背书（与 schema 默认值一致）；agent 搜集的才需要背书
    provenance: "HUMAN",
    endorsed,
    endorsedAt: endorsed ? createdAt : null,
  } as Forecast
}

function makeResolvedQuestion(resolution: Resolution): Question {
  return {
    id: "q1",
    createdAt: new Date(0),
    resolvedAt: new Date(DAY),
    resolution,
    // ADR-0031 §六：这条 fixture 表示「正常结算了的公共事实题」——有可核查来源，
    // 所以**所有**押过注的人都计入。无来源的悬空情形由 `settledByOther` 专门造，
    // 而不是靠 fixture 顺带覆盖：默认应当是正常路径，例外要写出来。
    resolved: true,
    resolutionSource: "https://example.org/evidence",
    confirmedByUserId: "author",
    // 公共事实类是默认路径（也是唯一进入相对分的一类，见 ADR-0002）
    oracleKind: "PUBLIC_FACT",
  } as Question
}

function makeOption(
  id: string,
  resolution: Resolution,
  forecasts: Forecast[],
): QuestionOption {
  return {
    id,
    questionId: "q1",
    text: `option ${id}`,
    userId: "author",
    createdAt: new Date(0),
    resolvedAt: new Date(DAY),
    resolution,
    forecasts,
    questionScores: [],
  } as unknown as QuestionOption
}

describe("scoreQuestion", () => {
  it("scores forecasts and persists questionScores for an unambiguous resolution", async () => {
    const question = {
      ...makeResolvedQuestion(Resolution.YES),
      forecasts: [makeForecast("good", 0.9)],
      questionScores: [],
    } as QuestionWithForecastsAndScores

    const scores = await scoreQuestion(Resolution.YES, question)

    expect(scores["good"].absoluteBrierScore).toBeCloseTo(0.02)
    expect(scores["good"].rank).toBe(1)
    expect(jest.mocked(prisma.questionScore.upsert)).toHaveBeenCalled()
  })

  it("AMBIGUOUS 不产生任何分数（ADR-0018：没有样本，而不是满分）", async () => {
    const question = {
      ...makeResolvedQuestion(Resolution.AMBIGUOUS),
      forecasts: [makeForecast("u1", 0.5)],
      questionScores: [],
    } as QuestionWithForecastsAndScores

    const scores = await scoreQuestion(Resolution.AMBIGUOUS, question)

    expect(scores).toEqual({})
    expect(jest.mocked(prisma.questionScore.upsert)).not.toHaveBeenCalled()
  })

  it("非公共事实类不写相对分，改按绝对分排名（ADR-0002）", async () => {
    const question = {
      ...makeResolvedQuestion(Resolution.YES),
      oracleKind: "SELF_REPORT",
      forecasts: [makeForecast("good", 0.9), makeForecast("bad", 0.1)],
      questionScores: [],
    } as unknown as QuestionWithForecastsAndScores

    const scores = await scoreQuestion(Resolution.YES, question)

    // 必须是 null：Prisma 把 undefined 当作「跳过该字段」，update 路径会留住旧的相对分；
    // 读侧（global-stats 的 `relativeScore !== null`）也只认 null。
    expect(scores["good"].relativeBrierScore).toBeNull()
    expect(scores["bad"].relativeBrierScore).toBeNull()
    expect(scores["good"].absoluteBrierScore).toBeCloseTo(0.02)
    expect(scores["good"].rank).toBe(1)
    expect(scores["bad"].rank).toBe(2)

    expect(jest.mocked(prisma.questionScore.upsert)).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ relativeScore: null }),
      }),
    )
  })

  it("未背书的预测值不参与计分（ADR-0008 / issue 04）", async () => {
    const question = {
      ...makeResolvedQuestion(Resolution.YES),
      forecasts: [
        makeForecast("endorsed", 0.9, new Date(0), true),
        makeForecast("unendorsed", 0.9, new Date(0), false),
      ],
      questionScores: [],
    } as QuestionWithForecastsAndScores

    const scores = await scoreQuestion(Resolution.YES, question)

    // 未背书的样本根本不进分数集合，因此也不会被写进 questionScore
    expect(Object.keys(scores)).toEqual(["endorsed"])
    expect(scores["unendorsed"]).toBeUndefined()

    const upsertedUserIds = jest
      .mocked(prisma.questionScore.upsert)
      .mock.calls.map(
        ([arg]) => (arg as { create: { userId: string } }).create.userId,
      )
    expect(upsertedUserIds).toEqual(["endorsed"])
  })

  /**
   * ADR-0031 §六：结算的生效范围。守门的对象是"被代签者的校准里不得混进他没有确认过
   * 的结算"，而它失效的方向是**静默多算**——多一个样本，没有任何东西会变红。
   */
  describe("结算生效范围（ADR-0031 §六）", () => {
    const settledByOther = (
      extra: Partial<Question> = {},
    ): QuestionWithForecastsAndScores =>
      ({
        ...makeResolvedQuestion(Resolution.YES),
        resolved: true,
        // A 确认了这次结算；B 押过注，但没参与确认
        confirmedByUserId: "A",
        resolutionSource: null,
        forecasts: [
          makeForecast("A", 0.9, new Date(0), true),
          makeForecast("B", 0.9, new Date(0), true),
        ],
        questionScores: [],
        ...extra,
      }) as unknown as QuestionWithForecastsAndScores

    it("无来源 + 他人确认 ⇒ 被代签者的预测不进计量（去掉守卫即变红）", async () => {
      const scores = await scoreQuestion(Resolution.YES, settledByOther())

      expect(Object.keys(scores)).toEqual(["A"])
      const upsertedUserIds = jest
        .mocked(prisma.questionScore.upsert)
        .mock.calls.map(
          ([arg]) => (arg as { create: { userId: string } }).create.userId,
        )
      expect(upsertedUserIds).toEqual(["A"])
    })

    it("带可核查来源 + 他人确认 ⇒ 计入（事实是谁确认都算）", async () => {
      const scores = await scoreQuestion(
        Resolution.YES,
        settledByOther({ resolutionSource: "https://data.example.org/cpi" }),
      )

      expect(Object.keys(scores).sort()).toEqual(["A", "B"])
    })

    it("无来源 + 本人确认 ⇒ 计入（那是他自己的判断，没替别人签字）", async () => {
      const scores = await scoreQuestion(
        Resolution.YES,
        settledByOther({ confirmedByUserId: "B" }),
      )

      // A 是确认者？不——这一次是 B 确认的，所以 A 悬空、B 计入。
      expect(Object.keys(scores)).toEqual(["B"])
    })

    it("补录来源后重算 ⇒ 原本悬空的那条重新计入（§五：补录不是撤销结算）", async () => {
      // 重算路径（rescoreResolvedQuestion）与直接结算走同一个计分入口，
      // 所以这里只需把"补录后的那一行"交给它。
      const scores = await scoreQuestion(
        Resolution.YES,
        settledByOther({ resolutionSource: "https://data.example.org/cpi" }),
      )

      expect(Object.keys(scores).sort()).toEqual(["A", "B"])
    })
  })
})

describe("scoreQuestionOptions", () => {
  type OptionsQuestion = Parameters<typeof scoreQuestionOptions>[1]

  function makeTwoOptionsQuestion(resolution: Resolution): OptionsQuestion {
    return {
      id: "q1",
      createdAt: new Date(0),
      resolvedAt: new Date(DAY),
      resolution,
      oracleKind: "PUBLIC_FACT",
      // 同 `makeResolvedQuestion`：正常结算（带来源）⇒ 所有人都计入
      resolved: true,
      resolutionSource: "https://example.org/evidence",
      confirmedByUserId: "author",
      forecasts: [] as Forecast[],
      options: [
        makeOption("o1", resolution, [
          makeForecast("good", 0.9),
          makeForecast("bad", 0.1),
        ]),
        makeOption("o2", resolution, [
          makeForecast("good", 0.9),
          makeForecast("bad", 0.1),
        ]),
      ],
    } as unknown as OptionsQuestion
  }

  it("ranks users by relative Brier score (lower = better)", async () => {
    const question = makeTwoOptionsQuestion(Resolution.YES)
    const scores = await scoreQuestionOptions(Resolution.YES, question, true)

    expect(scores["good"].rank).toBe(1)
    expect(scores["bad"].rank).toBe(2)
    expect(jest.mocked(prisma.questionScore.upsert)).toHaveBeenCalled()
  })

  it("averages scores across options when not exclusive", async () => {
    const question = makeTwoOptionsQuestion(Resolution.YES)
    const scores = await scoreQuestionOptions(Resolution.YES, question, false)

    // Two identical options: absolute score is (0.02 + 0.02) / 2 = 0.02
    expect(scores["good"].absoluteBrierScore).toBeCloseTo(0.02)
    expect(scores["bad"].absoluteBrierScore).toBeCloseTo(1.62)
  })

  it("sums scores across options when exclusive", async () => {
    const question = makeTwoOptionsQuestion(Resolution.YES)
    const scores = await scoreQuestionOptions(Resolution.YES, question, true)

    // Two identical options: absolute score is 0.02 + 0.02 = 0.04
    expect(scores["good"].absoluteBrierScore).toBeCloseTo(0.04)
    expect(scores["bad"].absoluteBrierScore).toBeCloseTo(3.24)
  })

  it("AMBIGUOUS 不产生任何分数（ADR-0018）", async () => {
    const question = {
      ...makeTwoOptionsQuestion(Resolution.AMBIGUOUS),
      forecasts: [makeForecast("u1", 0.5), makeForecast("u2", 0.3)],
    }
    const scores = await scoreQuestionOptions(
      Resolution.AMBIGUOUS,
      question,
      true,
    )

    expect(scores).toEqual({})
  })
})

describe("undoQuestionResolution", () => {
  it("clears option resolutions for exclusive-answer questions", async () => {
    await undoQuestionResolution("q1")

    expect(jest.mocked(prisma.$transaction)).toHaveBeenCalled()
    // The interactive-transaction stub defaults to exclusiveAnswers: true
  })

  it("does not touch options for non-exclusive questions", async () => {
    const txStub = {
      question: {
        update: jest.fn().mockResolvedValue({ exclusiveAnswers: false }),
      },
      questionOption: { updateMany: jest.fn() },
      questionScore: { deleteMany: jest.fn() },
    }
    jest.mocked(prisma.$transaction).mockImplementationOnce((arg: unknown) => {
      if (typeof arg === "function") return arg(txStub)
      return Promise.all(arg as Promise<unknown>[])
    })

    await undoQuestionResolution("q1")

    expect(txStub.questionOption.updateMany).not.toHaveBeenCalled()
    expect(txStub.questionScore.deleteMany).toHaveBeenCalled()
  })
})

describe("undoQuestionOptionResolution", () => {
  it("clears the option resolution and its scores in a transaction", async () => {
    await undoQuestionOptionResolution("o1")

    expect(jest.mocked(prisma.$transaction)).toHaveBeenCalled()
  })
})

describe("deleteQuestion", () => {
  it("deletes the question", async () => {
    await deleteQuestion("q1")

    expect(jest.mocked(prisma.question.delete)).toHaveBeenCalledWith({
      where: { id: "q1" },
    })
  })
})

/**
 * `dbResolveQuestion` 的返回形状：结算后的 Question 加上通知循环要用的关系。
 */
function makeResolvedQuestionWithRelations(
  resolution: Resolution,
): QuestionWithForecastsAndScores {
  return {
    ...makeResolvedQuestion(resolution),
    resolved: true,
    userId: "author",
    type: QuestionType.BINARY,
    user: { id: "author", name: "作者" },
    // 通知循环会读 `forecasts[].user`（`filterToUniqueIds` 不做空值过滤）
    forecasts: [
      { ...makeForecast("forecaster", 0.9), user: { id: "forecaster" } },
    ],
    comments: [],
    sharedWith: [],
    sharedWithLists: [],
    questionScores: [],
    options: [],
  } as unknown as QuestionWithForecastsAndScores
}

describe("rescoreResolvedQuestion（ADR-0008：背书可以发生在结算之后）", () => {
  it("尚未结算 ⇒ 什么都不写（不补分数，也不改 resolvedAt）", async () => {
    jest.mocked(prisma.question.findUnique).mockResolvedValue({
      id: "q1",
      resolved: false,
      resolution: null,
    } as unknown as Question)

    await rescoreResolvedQuestion("q1")

    expect(jest.mocked(prisma.questionScore.upsert)).not.toHaveBeenCalled()
    expect(jest.mocked(prisma.question.update)).not.toHaveBeenCalled()
  })

  it("已结算的二元题 ⇒ 按已存结论重算并落 questionScore", async () => {
    jest
      .mocked(prisma.question.findUnique)
      .mockResolvedValue(
        makeResolvedQuestionWithRelations(
          Resolution.YES,
        ) as unknown as Question,
      )

    await rescoreResolvedQuestion("q1")

    expect(jest.mocked(prisma.questionScore.upsert)).toHaveBeenCalled()
    // 重算不等于重新结算：resolvedAt 不能被碰
    expect(jest.mocked(prisma.question.update)).not.toHaveBeenCalled()
  })

  it("已结算的选项题 ⇒ 走选项计分并落 questionScore（不重新结算）", async () => {
    const question = {
      ...makeResolvedQuestion(Resolution.YES),
      resolved: true,
      type: QuestionType.MULTIPLE_CHOICE,
      exclusiveAnswers: false,
      forecasts: [],
      options: [
        makeOption("o1", Resolution.YES, [makeForecast("good", 0.9)]),
        makeOption("o2", Resolution.NO, [makeForecast("good", 0.9)]),
      ],
    }
    jest
      .mocked(prisma.question.findUnique)
      .mockResolvedValue(question as unknown as Question)

    await rescoreResolvedQuestion("q1")

    // 断言落在**选项级**：二元路径写 `good-q1`，选项路径写 `good-o1`。
    // 排他性（`exclusiveAnswers`）本身由 `scoreQuestionOptions` 那组测试守住；
    // 这里只证明 rescore 真的走了选项计分路径。
    expect(jest.mocked(prisma.questionScore.upsert)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userQuestionComboId: "good-o1" },
      }),
    )
    // 重算不等于重新结算：resolvedAt 不能被碰
    expect(jest.mocked(prisma.question.update)).not.toHaveBeenCalled()
  })
})

describe("handleQuestionResolution（结算入口，ADR-0004）", () => {
  it("二元题：写 resolved/resolution，计分，并给决策写下锁定时间（ADR-0020 第五点）", async () => {
    jest
      .mocked(prisma.question.update)
      .mockResolvedValue(
        makeResolvedQuestionWithRelations(Resolution.YES) as unknown as never,
      )

    await handleQuestionResolution("q1", Resolution.YES, QuestionType.BINARY)

    expect(jest.mocked(prisma.question.update)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "q1" },
        data: expect.objectContaining({ resolved: true, resolution: "YES" }),
      }),
    )
    expect(jest.mocked(prisma.questionScore.upsert)).toHaveBeenCalled()
    // 锁定时点只写在结算路径上：背书/拒绝写入那两条路径都不该写它
    expect(jest.mocked(prisma.decision.updateMany)).toHaveBeenCalledWith({
      where: { questions: { some: { id: "q1" } }, lockedAt: null },
      data: { lockedAt: expect.any(Date) },
    })
  })

  it("选项题：还有未结算的选项时先不结算、也不计分（等最后一个选项）", async () => {
    jest
      .mocked(prisma.questionOption.update)
      .mockResolvedValue(undefined as never)
    jest.mocked(prisma.questionOption.findMany).mockResolvedValue([
      { id: "o1", resolution: null },
      { id: "o2", resolution: Resolution.YES },
    ] as unknown as never)

    await handleQuestionResolution(
      "q1",
      Resolution.YES,
      QuestionType.MULTIPLE_CHOICE,
      "o1",
    )

    // 题级状态还没到可结算的时候：不计分，也不写决策的锁定时点
    // （`data: {}` 的那次 update 是选项自己的写入，不是题级结算）
    expect(jest.mocked(prisma.questionScore.upsert)).not.toHaveBeenCalled()
    expect(jest.mocked(prisma.decision.updateMany)).not.toHaveBeenCalled()
  })
})
