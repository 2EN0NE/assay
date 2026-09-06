import { Forecast, Question, Resolution } from "@prisma/client"
import { Prisma } from "@prisma/client"
import { relativeBrierScoring } from "./_scoring"

function makeForecast(
  userId: string,
  forecast: number,
  createdAt: Date,
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
  } as Forecast
}

function makeQuestion(resolution: Resolution): Question {
  return {
    id: "q1",
    createdAt: new Date(0),
    resolvedAt: new Date(24 * 60 * 60 * 1000), // 1 day later
    resolution,
  } as Question
}

describe("relativeBrierScoring", () => {
  it("gives a perfect binary forecast an absolute Brier score of 0", () => {
    const question = makeQuestion(Resolution.YES)
    const forecast = makeForecast("u1", 1.0, new Date(0))

    const scores = relativeBrierScoring([forecast], question)

    expect(scores["u1"].absoluteBrierScore).toBeCloseTo(0)
    expect(scores["u1"].rank).toBe(1)
  })

  it("gives a maximally wrong binary forecast a positive Brier score", () => {
    const question = makeQuestion(Resolution.YES)
    const forecast = makeForecast("u1", 0.0, new Date(0))

    const scores = relativeBrierScoring([forecast], question)

    expect(scores["u1"].absoluteBrierScore).toBeCloseTo(2)
  })

  it("ranks multiple users by relative Brier score (better = lower rank)", () => {
    const question = makeQuestion(Resolution.YES)
    const good = makeForecast("good", 0.9, new Date(0))
    const bad = makeForecast("bad", 0.1, new Date(0))

    const scores = relativeBrierScoring([good, bad], question)

    expect(scores["good"].rank).toBe(1)
    expect(scores["bad"].rank).toBe(2)
    expect(scores["good"].relativeBrierScore!).toBeLessThan(
      scores["bad"].relativeBrierScore!,
    )
  })

  it("returns an empty collection for no forecasts", () => {
    const question = makeQuestion(Resolution.YES)
    expect(relativeBrierScoring([], question)).toEqual({})
  })
})
