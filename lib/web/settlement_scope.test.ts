import {
  CONFIRMED_BY_OTHER_LABEL,
  countsTowardMetrics,
  DANGLING_LABEL,
  danglingReason,
  isDangling,
  settlementLabelOf,
  settlementScopeOf,
  SettlementRecord,
  SettlementScope,
  unscoredCauses,
} from "./settlement_scope"

/**
 * ADR-0031 §六 的四类用例 + 一条"去掉守卫即变红"的守门用例。
 *
 * 为什么这组断言值得单独存在：过滤规则失效的方向是**静默多算**——被代签者的
 * 校准里混进他没确认的结算，没有任何东西会变红。而这条规则同时又很容易被
 * "顺手放宽"（少一个条件看起来更全），所以四类必须逐格钉住。
 */

const settledBy = (
  confirmer: string | null,
  source: string | null = null,
): SettlementRecord => ({
  resolved: true,
  resolutionSource: source,
  confirmedByUserId: confirmer,
})

describe("结算生效范围（ADR-0031 §六）", () => {
  it("带可核查来源 + 他人确认 ⇒ 计入（事实是谁确认都算）", () => {
    const question = settledBy("A", "https://data.example.org/cpi")
    expect(countsTowardMetrics(question, "B")).toBe(true)
    expect(settlementScopeOf(question, "B")).toBe("EFFECTIVE")
  })

  it("无来源 + 他人确认 ⇒ **不计入**（去掉守卫即变红）", () => {
    const question = settledBy("A")
    // 这条就是守卫本身：去掉 `countsTowardMetrics` 里的来源/确认者判断，
    // 它立刻变成 true。
    expect(countsTowardMetrics(question, "B")).toBe(false)
    expect(settlementScopeOf(question, "B")).toBe("DANGLING")
  })

  it("无来源 + 本人确认 ⇒ 计入", () => {
    const question = settledBy("A")
    expect(countsTowardMetrics(question, "A")).toBe(true)
  })

  it("补录来源后 ⇒ 该题所有预测计入（§五），不触碰锁定", () => {
    const before = settledBy("A")
    expect(countsTowardMetrics(before, "B")).toBe(false)

    const after = {
      ...before,
      resolutionSource: "https://data.example.org/cpi",
    }
    expect(countsTowardMetrics(after, "B")).toBe(true)
  })

  it("未结算 ⇒ 既不是悬空也不是计入（悬空必须由来源缺失产生，而不是由'还没结算'产生）", () => {
    const question: SettlementRecord = {
      resolved: false,
      resolutionSource: null,
      confirmedByUserId: null,
    }
    expect(settlementScopeOf(question, "A")).toBe("UNRESOLVED")
    expect(countsTowardMetrics(question, "A")).toBe(false)
  })

  it("历史数据：确认者为 null 且无来源 ⇒ 悬空（不假装有人确认过）", () => {
    const question = settledBy(null)
    expect(countsTowardMetrics(question, "A")).toBe(false)
  })

  it("悬空的成因只有一种说法（措辞不臆测）", () => {
    // 先按类型收窄，再问成因："给非悬空的题问成因"现在不是一个可表达的调用。
    const question = settledBy("A")
    if (!isDangling(question, "B")) throw new Error("这个 fixture 本应是悬空的")
    expect(danglingReason(question)).toContain("来源")
  })

  it("isDangling 是那个类型守卫：与 §六 判据同源", () => {
    expect(isDangling(settledBy("A"), "B")).toBe(true)
    expect(isDangling(settledBy("A"), "A")).toBe(false)
    expect(isDangling(settledBy("A", "https://x"), "B")).toBe(false)
  })

  it("绕过类型问成因 ⇒ 大声失败（而不是静默返回空话）", () => {
    // 故意绕过类型：正常调用做不到（参数要求来源为 null）。正因如此，一旦有人用
    // `as` 绕过去，这里必须抛——"返回空串"那种设计只有在下一次把空串当成
    // "没有成因"时才会被发现。
    const withSource = settledBy(
      "A",
      "https://x",
    ) as unknown as SettlementRecord & {
      resolutionSource: null
    }

    expect(() => danglingReason(withSource)).toThrow(/只接受悬空的题/)
  })
})

describe("复盘里的标签（ADR-0031 §二/§三）", () => {
  it("悬空 ⇒ 显示名逐字是 §二 那一句", () => {
    expect(settlementLabelOf(settledBy("A"), "B")).toBe(DANGLING_LABEL)
    expect(settlementLabelOf(settledBy("A"), "B")).toBe(
      "未结算（无可核查来源）",
    )
  })

  it("有来源 + 他方确认 ⇒ 显示名是 §三 那一句", () => {
    expect(settlementLabelOf(settledBy("A", "https://x"), "B")).toBe(
      CONFIRMED_BY_OTHER_LABEL,
    )
  })

  it("确认者就是本人 ⇒ 不挂标签（自己签的字不必解释）", () => {
    expect(settlementLabelOf(settledBy("A"), "A")).toBeNull()
  })

  it("有来源 + 本人确认 ⇒ 不挂标签", () => {
    expect(settlementLabelOf(settledBy("A", "https://x"), "A")).toBeNull()
  })

  it("还没结算 ⇒ 不挂标签（悬空只能由来源缺失产生，不能由“还没结算”产生）", () => {
    const unresolved: SettlementRecord = {
      resolved: false,
      resolutionSource: null,
      confirmedByUserId: null,
    }
    expect(settlementLabelOf(unresolved, "A")).toBeNull()
  })
})

describe("复盘里“已揭晓却没有分数”的两种成因（§二 与 ADR-0018 不得混读）", () => {
  const q = (
    over: Partial<{
      resolved: boolean
      score: unknown
      settlementScope: SettlementScope
    }> = {},
  ) => ({
    resolved: true,
    score: null,
    settlementScope: "EFFECTIVE" as SettlementScope,
    ...over,
  })

  it("分开计数：悬空与判不出来各算各的，有分数或未揭晓的都不算", () => {
    expect(
      unscoredCauses([
        q({ settlementScope: "DANGLING" }),
        q({ settlementScope: "DANGLING" }),
        q(),
        q({ score: { absolute: 0.1 } }),
        q({ resolved: false }),
      ]),
    ).toEqual({ dangling: 2, ambiguous: 1 })
  })

  it("没有可数的就不编数", () => {
    expect(unscoredCauses([])).toEqual({ dangling: 0, ambiguous: 0 })
  })
})
