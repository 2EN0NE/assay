/**
 * 状态简报（Brief）——ADR-0039。
 *
 * 它是一份**现算、不落库**的当前状态快照：未结算预测的到期分布、最近几条、
 * 清单有未记录条目、未标领域、未背书数字、没有预测的决策。
 *
 * 为什么现算：落库的读数必然过期，而一旦过期，人会按过期的状态做决定——与
 * ADR-0020 第三点（完成度是推导值，不落库）是同一条理由。任何渠道（CLI、Web、
 * 每轮注入）读的都必须是同一条 procedure，因此这里只有**纯函数**，查询留在路由层。
 *
 * 为什么以 Prediction 计数：只有 Prediction 有 `resolveBy`。按决策计会出现
 * "简报说 8、list-due 说 12"两套数字，而这种不一致**不会报错**，只会让人不再
 * 相信任何一个数字。
 */

export const BRIEF_BUCKETS = [
  "overdue",
  "within1w",
  "within1m",
  "beyond1m",
] as const

export type BriefBucket = (typeof BRIEF_BUCKETS)[number]

const DAY_MS = 24 * 60 * 60 * 1000

/** 明细上限（ADR-0034 第四点：一条被无视的提醒和不存在没有区别）。 */
export const BRIEF_NEAREST_LIMIT = 3

/**
 * 到期分桶：按 `resolveBy` 与"现在"的差。
 *
 * 边界取闭区间（恰好 7 天算「一周内」、恰好 30 天算「一月内」），因为人对
 * "还有整一周"的直觉是"在一周内"。逾期单列——它回答的是"已经欠着了"，
 * 与"还有多久"是两种处境。
 */
export function bucketOf(resolveBy: Date, now: Date): BriefBucket {
  const delta = resolveBy.getTime() - now.getTime()
  if (delta < 0) return "overdue"
  if (delta <= 7 * DAY_MS) return "within1w"
  if (delta <= 30 * DAY_MS) return "within1m"
  return "beyond1m"
}

/**
 * 分桶对应的 `resolveBy` 区间——与 `bucketOf` 必须互为逆运算。
 *
 * 两处各写一遍边界（这里与 `bucketOf`）就会有缝隙：一条恰好落在一周整的预测
 * 会同时出现在两个桶里、或两个桶都不出现。所以下钻用的是这一个函数，测试
 * 用同一组边界值同时钉住两边。
 */
export type DateRange = { gt?: Date; gte?: Date; lt?: Date; lte?: Date }

export function bucketRangeOf(bucket: BriefBucket, now: Date): DateRange {
  const week = new Date(now.getTime() + 7 * DAY_MS)
  const month = new Date(now.getTime() + 30 * DAY_MS)
  switch (bucket) {
    case "overdue":
      return { lt: now }
    case "within1w":
      return { gte: now, lte: week }
    case "within1m":
      return { gt: week, lte: month }
    case "beyond1m":
      return { gt: month }
  }
}

export type DatedPrediction = {
  id: string
  title: string
  resolveBy: Date
  decisionId: string | null
}

export type DueSummary = Record<BriefBucket, number> & { unsettled: number }

export function summarizeDue(
  predictions: { resolveBy: Date }[],
  now: Date,
): DueSummary {
  const summary: DueSummary = {
    overdue: 0,
    within1w: 0,
    within1m: 0,
    beyond1m: 0,
    unsettled: predictions.length,
  }
  for (const prediction of predictions) {
    summary[bucketOf(prediction.resolveBy, now)] += 1
  }
  return summary
}

/**
 * 最近几条：**只从「逾期 + 一周内」取**，按到期由近到远。
 *
 * 清单未记录刻意不占这个位置：它在决策创建后就不变了，会永久占据 3 个位里的
 * 一个，而从第三轮起被无视。它改为独立一行（计数 + 下钻命令）。
 */
export function nearestDue<T extends { resolveBy: Date }>(
  predictions: T[],
  now: Date,
): T[] {
  return predictions
    .filter((prediction) => {
      const bucket = bucketOf(prediction.resolveBy, now)
      return bucket === "overdue" || bucket === "within1w"
    })
    .sort((a, b) => a.resolveBy.getTime() - b.resolveBy.getTime())
    .slice(0, BRIEF_NEAREST_LIMIT)
}

/**
 * 下钻命令（ADR-0039 第六点：只许指向**真实存在**的命令）。
 *
 * 它们随返回一起给出，而不是写在文档散文里——文档里的命令会过期，而返回值里
 * 的命令是否可跑由 `docs_commands.test.ts` 守着。
 */
export const BRIEF_SEE_ALSO = {
  overdue: "npm run --silent agent -- list-due --bucket overdue",
  within1w: "npm run --silent agent -- list-due --bucket 1w",
  within1m: "npm run --silent agent -- list-due --bucket 1m",
  beyond1m: "npm run --silent agent -- list-due --bucket 1m+",
  rubricMissing: "npm run --silent agent -- list-decisions --rubric-missing",
  untagged: "npm run --silent agent -- list-untagged-decisions",
  unendorsed: "npm run --silent agent -- list-unendorsed",
  // ADR-0041：承诺到期却没执行也没放弃的决策
  actionOverdue: "npm run --silent agent -- list-decisions --action-overdue",
} as const
