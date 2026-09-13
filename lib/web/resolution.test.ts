import { Forecast, Question, QuestionOption, Resolution } from "@prisma/client"
import { Prisma } from "@prisma/client"
import type { QuestionWithForecastsAndScores } from "../../prisma/additional"

// Avoid loading notifications -> _utils_server -> node-fetch (ESM) in jsdom
jest.mock("./notifications", () => ({
  createNotification: jest.fn(),
  sendEmailReadyToResolveNotification: jest.fn(),
  sendBatchedEmails: jest.fn(),
  sendEmailWithTemplateUnbatched: jest.fn(),
  sendEmailUnbatched: jest.fn(),
  fatebookEmailFooter: jest.fn(),
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
      question: { update: jest.fn(), delete: jest.fn() },
      questionOption: { update: jest.fn(), updateMany: jest.fn() },
      questionScore: { deleteMany: jest.fn(), upsert: jest.fn() },
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
  scoreQuestion,
  scoreQuestionOptions,
  undoQuestionOptionResolution,
  undoQuestionResolution,
} from "./resolution"

const DAY = 24 * 60 * 60 * 1000

function makeForecast(
  userId: string,
  forecast: number,
  createdAt = new Date(0),
  endorsed = true,
): Forecast {
  return {
    id: Math.floor(Math.random() * 100000),
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
