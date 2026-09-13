/**
 * 计分口径的唯一定义处：谁进校准（ADR-0008）、谁进相对分（ADR-0002）。
 *
 * - **校准样本**：Agent 自主搜集的记录必须经当事人**背书**才计入；未背书者可展示、
 *   可复盘，但不作校准样本。
 * - **相对分 / 排行榜**：只有**公共事实类**进入——相对分要求同一命题上存在多个
 *   可比预测者，而他人无法对当事人的自评或私人体感下注。
 *
 * 这两条规则都必须只有一处定义，否则迟早会出现"某个视图忘了排除"的不一致，
 * 而校准曲线一旦被污染就无法察觉。
 */

/** 可直接展开进 Prisma `where` 的过滤器片段。 */
export const ENDORSED_ONLY = { endorsed: true } as const

/** 内存中过滤已加载的记录。 */
export function endorsedForecasts<T extends { endorsed: boolean }>(
  forecasts: T[],
): T[] {
  return forecasts.filter((forecast) => forecast.endorsed)
}

/**
 * ADR-0002：唯一进入相对分 / 排行榜的判据类型。
 *
 * 非法值（含缺字段）一律视为**不进入**——宁可少算，不可污染排行榜。
 */
export function isRelativeScored(oracleKind: string | undefined): boolean {
  return oracleKind === "PUBLIC_FACT"
}

/** 可直接展开进 `where: { question: { ... } }` 的过滤器片段。 */
export const RELATIVE_SCORED_ONLY = { oracleKind: "PUBLIC_FACT" } as const
