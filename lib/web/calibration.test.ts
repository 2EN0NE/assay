import {
  ENDORSED_ONLY,
  endorsedForecasts,
  isRelativeScored,
  RELATIVE_SCORED_ONLY,
} from "./calibration"

describe("校准样本定义（ADR-0008）", () => {
  it("ENDORSED_ONLY 可直接展开进 Prisma where", () => {
    // 与其它条件合并后不应互相覆盖
    const where = { userId: "u1", ...ENDORSED_ONLY }
    expect(where).toEqual({ userId: "u1", endorsed: true })
  })

  it("endorsedForecasts 剔除未背书的 agent 搜集样本", () => {
    const forecasts = [
      { id: 1, endorsed: true },
      { id: 2, endorsed: false },
      { id: 3, endorsed: true },
    ]
    expect(endorsedForecasts(forecasts).map((f) => f.id)).toEqual([1, 3])
  })

  it("保留原对象，便于计分时读取其它字段", () => {
    const forecasts = [{ id: 1, endorsed: true, forecast: 0.7, userId: "u1" }]
    const [kept] = endorsedForecasts(forecasts)
    expect(kept).toBe(forecasts[0])
    expect(kept.forecast).toBe(0.7)
  })

  it("全部未背书时返回空数组——这些预测仍会留在系统里，只是不进校准", () => {
    expect(endorsedForecasts([{ endorsed: false }])).toEqual([])
  })
})

describe("相对分资格（ADR-0002）", () => {
  it("只有公共事实类进入相对分 / 排行榜", () => {
    expect(isRelativeScored("PUBLIC_FACT")).toBe(true)
    expect(isRelativeScored("AGENT_OBSERVABLE")).toBe(false)
    expect(isRelativeScored("SELF_REPORT")).toBe(false)
  })

  it("缺字段 / 非法值一律不进入——宁可不算，不可污染排行榜", () => {
    expect(isRelativeScored(undefined)).toBe(false)
    expect(isRelativeScored("")).toBe(false)
  })

  it("RELATIVE_SCORED_ONLY 可直接展开进 question 关系过滤", () => {
    expect({ question: { ...RELATIVE_SCORED_ONLY } }).toEqual({
      question: { oracleKind: "PUBLIC_FACT" },
    })
  })
})
