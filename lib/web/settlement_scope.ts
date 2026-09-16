/**
 * 结算的**生效范围**（ADR-0031）。
 *
 * 与 `settlement_authority.ts` 是两个独立问题，刻意分开：
 *
 * - 授权（谁有权确认）：由 `decideSettlement()` 的矩阵回答。
 * - 生效范围（确认之后约束谁）：由这里的判据回答。
 *
 * 判据只有一条：**结算记录有没有可核查来源**。
 * 有 ⇒ 它陈述的是事实，谁确认都算；没有 ⇒ 它陈述的是某人的判断，不得替别人签字
 * ——被代签者的 Forecast **悬空**：不进校准、不进任何分数，但仍然出现在复盘与
 * 清单里（让"没有计量"和"没有这条预测"在复盘时不可区分，才是真问题，§二）。
 *
 * 为什么要做成纯函数 + 一条可推导的规则：ADR-0031 §六 明写**不做**
 * (question, user) 确认状态表。悬空状态是**推导**出来的，不是存储的。
 */

/** 一条 Forecast 相对某次结算的处境。 */
export type SettlementScope =
  /** 题还没结算：谈不上悬空，也谈不上计入。 */
  | "UNRESOLVED"
  /** 已结算，但这次结算对**这条** Forecast 不生效（悬空）。 */
  | "DANGLING"
  /** 已结算，且这次结算对这条 Forecast 生效（计入计量）。 */
  | "EFFECTIVE"

export type SettlementRecord = {
  resolved: boolean
  /** 结算证据的来源（ADR-0004）。为 null 表示这次结算只是某人的判断。 */
  resolutionSource: string | null
  /** 谁确认的这次结算（ADR-0031 §三）。 */
  confirmedByUserId: string | null
}

/**
 * 判据（ADR-0031 §六），逐字对应该 ADR 里那条公式：
 *
 * ```text
 * question.resolved && (resolution.source != null || forecast.userId === resolution.confirmedBy)
 * ```
 */
export function settlementScopeOf(
  question: SettlementRecord,
  forecastUserId: string,
): SettlementScope {
  if (!question.resolved) return "UNRESOLVED"
  if (question.resolutionSource !== null) return "EFFECTIVE"
  if (question.confirmedByUserId === null) return "DANGLING"
  return forecastUserId === question.confirmedByUserId
    ? "EFFECTIVE"
    : "DANGLING"
}

/** 计量入口唯一该问的问题。 */
export function countsTowardMetrics(
  question: SettlementRecord,
  forecastUserId: string,
): boolean {
  return settlementScopeOf(question, forecastUserId) === "EFFECTIVE"
}

/**
 * 类型守卫：这条 Forecast 相对这次结算是否悬空。
 *
 * 它的返回值不只是一个布尔——它同时把「悬空 ⇒ `resolutionSource` 必为 null」
 * （§六 判据的直接推论）交给类型系统，让下游不必再自己推一遍。
 */
export function isDangling<T extends SettlementRecord>(
  question: T,
  forecastUserId: string,
): question is T & { resolutionSource: null } {
  return settlementScopeOf(question, forecastUserId) === "DANGLING"
}

/**
 * 悬空的成因。写成函数而不是散落的字符串：成因是给人看的一句话，
 * 它出现的地方（队列、复盘）不只一处，措辞必须一致。
 *
 * 参数刻意收窄成 `resolutionSource: null`：§六 的判据是“来源为 null ⇒ 悬空”，
 * 所以“给非悬空的题问成因”在规则上根本不是一种情形。让它在类型层面无法表达，
 * 胜过在这里再写一个 `return ""` 的分支——那种分支调用方分不清，
 * 而“分不清”正是这个模块要消灭的东西。排队时用 `isDangling` 把类型收窄。
 */
export function danglingReason(
  question: SettlementRecord & { resolutionSource: null },
): string {
  // 参数服务于先决条件，而不是为了摆样子。类型已经保证这里为 null；
  // 保留这次检查是为了让**绕过类型**的调用大声失败，而不是静默返回一句空话
  // ——那只会在下一次把“空串”当成“没有成因”的时候才被发现。
  if (question.resolutionSource !== null) {
    throw new Error(
      "danglingReason 只接受悬空的题：来源为 null 是 §六 判据的一部分",
    )
  }
  return "结算是他人确认的，且没有可核查来源：这条预测不计入计量，等来源补录后自动生效（ADR-0031 §五）"
}

/**
 * §二 规定的显示名。同样是常量而不是散落的字符串：一个状态在队列、复盘、清单里
 * 必须长得一样，而"换个说法"正是这条规则最容易漂移的地方。
 */
export const DANGLING_LABEL = "未结算（无可核查来源）"

/** §三：结算由他方确认时，给当事人的显示名（确认者那一格服务的"呈现"用途）。 */
export const CONFIRMED_BY_OTHER_LABEL = "由他方确认结算"

/**
 * 复盘里给这条 Forecast 挂的标签；没有可挂的就返回 `null`。
 *
 * 两件事在这里合流：悬空（§二）必须看得出来是"未结算"，而结算由他方确认（§三）
 * 必须看得出来"不是我签的字"。判定本身仍然只有 `settlementScopeOf` 一处。
 */
export function settlementLabelOf(
  question: SettlementRecord,
  forecastUserId: string,
): string | null {
  const scope = settlementScopeOf(question, forecastUserId)
  if (scope === "DANGLING") return DANGLING_LABEL
  if (
    scope === "EFFECTIVE" &&
    question.confirmedByUserId !== null &&
    question.confirmedByUserId !== forecastUserId
  ) {
    return CONFIRMED_BY_OTHER_LABEL
  }
  return null
}

/**
 * 复盘里“已揭晓却没有分数”的两种成因，**必须分开计数**（§二）：
 *
 * - `dangling`：结算是他人确认的、且没有可核查来源 ⇒ 压根不该计分；
 * - `ambiguous`：判据判不出来（ADR-0018）⇒ 没有样本可计。
 *
 * 合成一个数就是把两种不同的“没有分数”讲成同一件事，而那正是 §二 要防的：
 * “让‘没有计量’和‘没有这条预测’在复盘时不可区分，才是真问题”。
 */
export function unscoredCauses<
  T extends {
    resolved: boolean
    score: unknown
    settlementScope: SettlementScope
  },
>(questions: readonly T[]): { dangling: number; ambiguous: number } {
  const unscored = questions.filter(
    (question) => question.resolved && question.score === null,
  )
  const dangling = unscored.filter(
    (question) => question.settlementScope === "DANGLING",
  ).length
  return { dangling, ambiguous: unscored.length - dangling }
}
