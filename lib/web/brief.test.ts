import {
  BRIEF_NEAREST_LIMIT,
  bucketOf,
  bucketRangeOf,
  nearestDue,
  summarizeDue,
} from "./brief"

const NOW = new Date("2026-10-19T00:00:00Z")
const day = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000)

describe("bucketOf（ADR-0039：按 resolveBy 分桶，边界取闭区间）", () => {
  it("逾期单列：它回答的是「已经欠着了」，与「还有多久」不同", () => {
    expect(bucketOf(day(-1), NOW)).toBe("overdue")
  })

  it("恰好一周算「一周内」——人对「还有整一周」的直觉就是在一周内", () => {
    expect(bucketOf(day(7), NOW)).toBe("within1w")
    expect(bucketOf(day(8), NOW)).toBe("within1m")
  })

  it("恰好 30 天算「一月内」", () => {
    expect(bucketOf(day(30), NOW)).toBe("within1m")
    expect(bucketOf(day(31), NOW)).toBe("beyond1m")
  })

  it("分桶与下钻区间互为逆运算：同一个时点不会落进两个桶、也不会落空", () => {
    for (const offset of [-1, 0, 1, 7, 8, 30, 31]) {
      const at = day(offset)
      const bucket = bucketOf(at, NOW)
      const range = bucketRangeOf(bucket, NOW)

      const afterStart =
        (range.gte === undefined || at.getTime() >= range.gte.getTime()) &&
        (range.gt === undefined || at.getTime() > range.gt.getTime())
      const beforeEnd =
        (range.lte === undefined || at.getTime() <= range.lte.getTime()) &&
        (range.lt === undefined || at.getTime() < range.lt.getTime())

      expect({ offset, in: afterStart && beforeEnd }).toEqual({
        offset,
        in: true,
      })
    }
  })
})

describe("summarizeDue（单位是 Prediction，总数也要给）", () => {
  it("只报计数不够：总数与分布一起给，否则读的人以为「就这些」", () => {
    const summary = summarizeDue(
      [
        { resolveBy: day(-1) },
        { resolveBy: day(3) },
        { resolveBy: day(10) },
        { resolveBy: day(60) },
        { resolveBy: day(90) },
      ],
      NOW,
    )

    expect(summary).toEqual({
      overdue: 1,
      within1w: 1,
      within1m: 1,
      beyond1m: 2,
      unsettled: 5,
    })
  })
})

describe("nearestDue（ADR-0039 第四点）", () => {
  it("只从「逾期 + 一周内」取，按到期由近到远", () => {
    const predictions = [
      { id: "later", resolveBy: day(20) },
      { id: "week", resolveBy: day(6) },
      { id: "overdue", resolveBy: day(-2) },
      { id: "soon", resolveBy: day(1) },
    ]

    expect(nearestDue(predictions, NOW).map((p) => p.id)).toEqual([
      "overdue",
      "soon",
      "week",
    ])
  })

  it("上限 3 条：一条被无视的提醒和不存在没有区别（ADR-0034 第四点）", () => {
    const predictions = [0, 1, 2, 3, 4].map((n) => ({
      id: String(n),
      resolveBy: day(n),
    }))

    const nearest = nearestDue(predictions, NOW)
    expect(nearest).toHaveLength(BRIEF_NEAREST_LIMIT)
    expect(nearest.map((p) => p.id)).toEqual(["0", "1", "2"])
  })

  it("一月内/一月以上的到期项不占明细位——它们不是「最近」", () => {
    expect(nearestDue([{ id: "far", resolveBy: day(40) }], NOW)).toHaveLength(0)
  })
})
