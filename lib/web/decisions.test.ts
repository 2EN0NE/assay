import {
  normalizeDecisionNarrative,
  normalizeNarrativePatch,
} from "./decisions"

describe("normalizeDecisionNarrative（ADR-0001 / ADR-0019 · ticket 01）", () => {
  it("陈述必填：空白陈述被拒绝——一个决策必须说清它在决定什么", () => {
    expect(() => normalizeDecisionNarrative({ statement: "   " })).toThrow(
      /陈述/,
    )
  })

  it("叙事字段去首尾空白，空串与纯空白归一为 null", () => {
    expect(
      normalizeDecisionNarrative({
        statement: "  接这个 offer ",
        reasoning: "",
        expectedOutcome: "  ",
        knownInfo: " 团队刚融资 ",
        unknownInfo: null,
      }),
    ).toEqual({
      statement: "接这个 offer",
      reasoning: null,
      expectedOutcome: null,
      knownInfo: "团队刚融资",
      unknownInfo: null,
    })
  })

  it("除陈述外全部可空——只有一个陈述的决策是合法的", () => {
    expect(normalizeDecisionNarrative({ statement: "换个城市生活" })).toEqual({
      statement: "换个城市生活",
      reasoning: null,
      expectedOutcome: null,
      knownInfo: null,
      unknownInfo: null,
    })
  })
})

describe("normalizeNarrativePatch（ADR-0012 / ADR-0020 · ticket 13）", () => {
  it("只包含调用方真正提到的字段——没提到的不能写成 null", () => {
    // 这是本模块最容易犯而最难发现的错误：改一句话顺手抹掉另外四栏，
    // 更新成功、响应也是 200，而记录已经被清空。
    expect(normalizeNarrativePatch({ reasoning: " 换个说法 " })).toEqual({
      reasoning: "换个说法",
    })
  })

  it("一个字段都不提 ⇒ 空补丁（什么都不写）", () => {
    expect(normalizeNarrativePatch({})).toEqual({})
  })

  it("显式传 null / 空串 = 清空该字段（改写，须由调用方带理由）", () => {
    expect(
      normalizeNarrativePatch({ reasoning: null, knownInfo: "   " }),
    ).toEqual({ reasoning: null, knownInfo: null })
  })

  it("陈述被改时同样去空白；改成空白即拒绝", () => {
    expect(normalizeNarrativePatch({ statement: " 新陈述 " })).toEqual({
      statement: "新陈述",
    })
    expect(() => normalizeNarrativePatch({ statement: "   " })).toThrow(/陈述/)
  })
})
