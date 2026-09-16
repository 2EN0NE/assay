import { computeDomainAssessment, N_MIN_FOR_VERDICT } from "./domain_stats"
import { DomainSample, fixtureFor } from "./fixtures/domain_samples"

/**
 * 领域读数的判据测试（ADR-0032 / ADR-0033）。
 *
 * 这些数字没有任何症状：算错的技能分照样是个数字，照样带一个像模像样的区间。
 * 所以每条断言都必须是**能被单条推理复算**的——这就是 fixture 存在的理由。
 */

const assess = (domain: string) => {
  const fixture = fixtureFor(domain)
  return computeDomainAssessment(domain, fixture.samples, fixture.pending)
}

describe("领域读数（ADR-0032 / ADR-0033）", () => {
  it("校准良好 ⇒ 技能分为正，区间不跨 0（verdict: better）", () => {
    const report = assess("投资/宏观")

    expect(report.n).toBe(40)
    // 0.9 组实际 18/20、0.1 组实际 2/20 ⇒ Brier 明显低于基准率策略的 Brier
    expect(report.skillScore).toBeGreaterThan(0)
    expect(report.ci?.[0]).toBeGreaterThan(0)
    expect(report.verdict).toBe("better")
    expect(report.brier).toBeCloseTo(0.09, 6)
    expect(report.brierRef).toBeCloseTo(0.25, 6)
  })

  it("过度自信 ⇒ 技能分为负（verdict: worse）", () => {
    const report = assess("投资/公司业绩")

    expect(report.n).toBe(24)
    expect(report.skillScore).toBeLessThan(0)
    expect(report.ci?.[1]).toBeLessThan(0)
    expect(report.verdict).toBe("worse")
  })

  it("每条题都押领域基准率 ⇒ 技能分**恰好为 0**，且区间跨 0（自证：去掉参照逻辑即变红）", () => {
    const report = assess("投资/估值与价格")

    expect(report.n).toBe(20)
    // 按构造 Brier == Brier_ref ⇒ 技能分必须是 0，而不是"接近 0"。
    // 把基准率改成任何常数（例如硬编码 0.5 去算别的领域）或去掉参照逻辑，这里变红。
    expect(report.skillScore).toBe(0)
    expect(report.ci?.[0]).toBeLessThanOrEqual(0)
    expect(report.ci?.[1]).toBeGreaterThanOrEqual(0)
    // 区间跨 0 ⇒ 只允许"无法判断方向"，不许说成"略有提升"
    expect(report.verdict).toBe("inconclusive")
  })

  it("样本不足（n < 5）⇒ 连桶都不给，只给 n 与悬空计数", () => {
    const report = assess("投资/交易水平")

    expect(report.n).toBe(3)
    expect(report.pending).toBe(1)
    expect(report.bins).toBeUndefined()
    expect(report.skillScore).toBeUndefined()
    expect(report.verdict).toBeUndefined()
  })

  it("5 ≤ n < 20 ⇒ 给形状（桶/分辨率/Brier），但不给技能分与区间", () => {
    const macro = fixtureFor("投资/宏观")
    const report = computeDomainAssessment(
      "投资/宏观",
      macro.samples.slice(0, N_MIN_FOR_VERDICT - 8),
      [],
    )

    expect(report.n).toBe(12)
    expect(report.bins).toHaveLength(10)
    expect(report.brier).toBeDefined()
    expect(report.resolution).toBeDefined()
    // 阈值以下不出现判据字段：宁可少说，不可把噪音当结论
    expect(report.skillScore).toBeUndefined()
    expect(report.ci).toBeUndefined()
    expect(report.verdict).toBeUndefined()
  })

  it("悬空样本进分母、不进判据（ADR-0031 §二 / ADR-0032 §六）", () => {
    const macro = fixtureFor("投资/宏观")
    const withPending = computeDomainAssessment(
      "投资/宏观",
      macro.samples,
      macro.pending,
    )
    const withoutPending = computeDomainAssessment("投资/宏观", macro.samples, [
      ...macro.pending,
      { questionId: "extra-dangling" },
    ])

    expect(withPending.pending).toBe(2)
    expect(withPending.n).toBe(40)
    // 再加悬空样本：分母变、判据不变
    expect(withoutPending.pending).toBe(3)
    expect(withoutPending.n).toBe(40)
    expect(withoutPending.skillScore).toBe(withPending.skillScore)
    expect(withoutPending.brier).toBe(withPending.brier)
  })

  it("固定种子 ⇒ 同数据两次运行逐位相同（防 flaky）", () => {
    const first = assess("投资/宏观")
    const second = assess("投资/宏观")

    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })

  it("结果与输入顺序无关（数据库返回行的顺序是不确定的）", () => {
    const macro = fixtureFor("投资/宏观")
    const shuffled: DomainSample[] = [
      ...macro.samples.slice(20),
      ...macro.samples.slice(0, 20),
    ]

    const inOrder = computeDomainAssessment("投资/宏观", macro.samples, [])
    const outOfOrder = computeDomainAssessment("投资/宏观", shuffled, [])

    expect(JSON.stringify(outOfOrder)).toBe(JSON.stringify(inOrder))
  })

  it("读数自带「包含子标签」的声明（ADR-0030 §十三：宽口径不许被误读成细分口径）", () => {
    expect(assess("投资/宏观").includesDescendants).toBe(true)
  })
})
