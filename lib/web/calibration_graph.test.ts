import { Prisma, QuestionType, Resolution } from "@prisma/client"
import prisma from "../prisma"
import { getBucketedForecasts } from "../../pages/api/calibration_graph"

/**
 * 校准图的守门测试（AGENTS.md「可观测性契约」/ ADR-0008）。
 *
 * 校准曲线是"未背书样本静默污染校准"的**可见面**，而这条规则一旦被违反
 * **没有任何症状**：图照常画出来，只是多算了不该算的样本。此前这个端点
 * 0% 覆盖，三处 `...ENDORSED_ONLY` 的存在只靠人眼。
 *
 * 这里断言的是**查询本身**（DB 才是过滤发生的地方），不是 mock 喂进去的数据。
 *
 * 为什么这个测试在 `lib/web/` 而不在 `pages/api/` 旁边：**Next.js 会把 `pages/` 下的
 * 任意 `.ts` 文件当成路由**（`.test.ts` 也不例外——实测 `next build` 会产出
 * `/api/calibration_graph.test` 这条路由）。测试文件一旦放进 `pages/`，生产构建里就
 * 多一个会去加载 jest 模块的端点。其余目录（`lib/` `components/` `cli/`）没这个约束。
 */

jest.mock("chart.js-image", () => ({
  __esModule: true,
  default: class {
    chart(): this {
      return this
    }
    backgroundColor(): this {
      return this
    }
    width(): this {
      return this
    }
    height(): this {
      return this
    }
  },
}))

jest.mock("./utils", () => ({
  getChartJsParams: jest.fn(() => ({})),
}))

jest.mock("../prisma", () => ({
  __esModule: true,
  default: { question: { findMany: jest.fn() } },
}))

const questionFindMany = jest.mocked(prisma.question.findMany)

type ForecastRow = { forecast: Prisma.Decimal; createdAt: Date }

function forecast(value: number, createdAt = new Date(0)): ForecastRow {
  return { forecast: new Prisma.Decimal(value), createdAt }
}

function binaryQuestion(
  resolution: Resolution,
  forecasts: ForecastRow[],
): unknown {
  return {
    id: "q1",
    type: QuestionType.BINARY,
    resolution,
    // ADR-0031 §六：这组 fixture 关心的是查询条件与同分钟去重，不是结算范围。
    // 给一条可核查来源，让范围规则对所有押过注的人生效（否则一个样本都不计入，
    // 而这些用例会以「过滤把数据抹掉了」的形式失败——那不是它们要测的东西）。
    resolved: true,
    resolutionSource: "https://example.org/evidence",
    confirmedByUserId: "author",
    forecasts,
    options: [],
  }
}

/** 取出传给 prisma 的查询参数（这是被测对象：过滤条件在这里）。 */
function lastQuery(): {
  where: {
    AND: Array<Record<string, unknown>>
  }
  include: {
    forecasts: { where: Record<string, unknown> }
    options: { include: { forecasts: { where: Record<string, unknown> } } }
  }
} {
  const call = questionFindMany.mock.calls.at(-1)
  if (!call) throw new Error("prisma.question.findMany 未被调用")
  return call[0] as never
}

describe("getBucketedForecasts 的查询：未背书样本不得进入校准图（ADR-0008）", () => {
  beforeEach(() => {
    questionFindMany.mockResolvedValue([] as never)
  })

  it("题级过滤条件里带上 endorsed: true", async () => {
    await getBucketedForecasts("u1")

    const { where } = lastQuery()
    // AND[0] = 只看已结算的题（二元 / 选项之一），AND[1] = 该用户有已背书的预测
    expect(where.AND[1]).toEqual({
      forecasts: {
        some: { userId: { equals: "u1" }, endorsed: true },
      },
    })
  })

  it("AMBIGUOUS 的题在查询层被排除（判不出来 ≠ 判错）", async () => {
    await getBucketedForecasts("u1")

    // 二元与选项题都只认 YES / NO：AMBIGUOUS 在 SQL 层就被挡掉。JS 分桶不做
    // 这层过滤（二元题不过滤 `resolution`），所以这里只能断言查询本身。
    expect(lastQuery().where.AND[0]).toEqual({
      OR: [
        {
          type: QuestionType.BINARY,
          resolution: { in: [Resolution.YES, Resolution.NO] },
        },
        {
          type: QuestionType.MULTIPLE_CHOICE,
          options: {
            some: {
              resolution: { in: [Resolution.YES, Resolution.NO] },
            },
          },
        },
      ],
    })
  })

  it("include 里的题级预测也带 endorsed: true（读出来的每一行都要滤过）", async () => {
    await getBucketedForecasts("u1")

    expect(lastQuery().include.forecasts.where).toEqual({
      userId: { equals: "u1" },
      endorsed: true,
    })
  })

  it("选项题（MULTIPLE_CHOICE）的选项预测同样带 endorsed: true", async () => {
    await getBucketedForecasts("u1")

    expect(lastQuery().include.options.include.forecasts.where).toEqual({
      userId: { equals: "u1" },
      endorsed: true,
    })
  })

  it("不给 tags 时不下标签条件（空的 {} 而不是过滤掉一切）", async () => {
    await getBucketedForecasts("u1")

    expect(lastQuery().where.AND[2]).toEqual({})
  })

  it("给 tags 时按「这些标签、且属于本人」过滤", async () => {
    await getBucketedForecasts("u1", ["决策", "投资"])

    expect(lastQuery().where.AND[2]).toEqual({
      tags: {
        some: { name: { in: ["决策", "投资"] }, userId: "u1" },
      },
    })
  })
})

describe("getBucketedForecasts 的分桶", () => {
  it("10 个等宽桶：预测值落进对应桶，空桶用桶中心占位、meanOutcome 为 NaN", async () => {
    questionFindMany.mockResolvedValue([
      binaryQuestion(Resolution.YES, [forecast(0.05), forecast(0.95)]),
    ] as never)

    const { bucketedForecasts } = (await getBucketedForecasts("u1"))!

    expect(bucketedForecasts).toHaveLength(10)
    expect(bucketedForecasts[0].count).toBe(1)
    expect(bucketedForecasts[9].count).toBe(1)
    expect(bucketedForecasts[4].count).toBe(0)
    expect(bucketedForecasts[4].meanPrediction).toBeCloseTo(0.45)
    expect(bucketedForecasts[4].meanOutcome).toBeNaN()
    // YES 的那条落在 [90%,100%) 桶里 ⇒ 该桶 meanOutcome = 1
    expect(bucketedForecasts[9].meanOutcome).toBe(1)
  })

  it("预测值恰好为 1.0 时落进最后一桶（getBinIndex 的边界）", async () => {
    questionFindMany.mockResolvedValue([
      binaryQuestion(Resolution.YES, [forecast(1)]),
    ] as never)

    const { bucketedForecasts } = (await getBucketedForecasts("u1"))!

    expect(bucketedForecasts[9].count).toBe(1)
  })
})

describe("getBucketedForecasts 的去重（同一分钟内改预测只算最新那条）", () => {
  it("同一用户 30 秒内改了两次预测 ⇒ 只计最新的那条", async () => {
    const earlier = forecast(0.2, new Date(0))
    const later = forecast(0.9, new Date(30_000))
    questionFindMany.mockResolvedValue([
      binaryQuestion(Resolution.YES, [earlier, later]),
    ] as never)

    const { bucketedForecasts } = (await getBucketedForecasts("u1"))!

    const total = bucketedForecasts.reduce((sum, b) => sum + b.count, 0)
    expect(total).toBe(1)
    // 留下的是 0.9（第 9 桶），被丢弃的是 0.2（第 1 桶）
    expect(bucketedForecasts[9].count).toBe(1)
    expect(bucketedForecasts[1].count).toBe(0)
  })
})
