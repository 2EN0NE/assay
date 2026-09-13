/**
 * 修订留痕（ADR-0012）。
 *
 * 已冻结字段（结算判据 / 期限 / 评分锚点）**可改，但必留痕**。留痕之所以够用，
 * 是因为 Resolution Drift 的杀伤力来自**无声**——一旦"我改过判据"被记录下来，
 * 它本身就成了复盘材料。
 *
 * 唯一的例外：**首次 Forecast 之前**的改动不算修订。那时还没有任何信念被记录，
 * 改动无漂移可言，纯粹是修文字。
 */

export const REVISION_TRACKED_FIELDS = [
  "resolveBy",
  "resolutionCriteria",
  "scoringAnchor",
] as const

export type RevisionTrackedField = (typeof REVISION_TRACKED_FIELDS)[number]

export type RevisionDraft = {
  field: RevisionTrackedField
  oldValue: string | null
  newValue: string | null
}

export type RevisionSnapshot = {
  resolveBy: Date
  resolutionCriteria: string | null
  scoringAnchor: string | null
}

export type RevisionPatch = {
  resolveBy?: Date
  resolutionCriteria?: string
  scoringAnchor?: string
}

function serialize(value: Date | string | null): string | null {
  if (value === null) return null
  return value instanceof Date ? value.toISOString() : value
}

function isSame(
  before: Date | string | null,
  after: Date | string | null,
): boolean {
  if (before instanceof Date || after instanceof Date) {
    const beforeTime = before instanceof Date ? before.getTime() : null
    const afterTime = after instanceof Date ? after.getTime() : null
    return beforeTime === afterTime
  }
  return before === after
}

/**
 * 纯函数：算出这次改动应当留下哪些修订记录。
 *
 * 返回空数组有两种情形，且**都重要**：没有实际变化，或首次 Forecast 尚未发生。
 */
export function planRevisions(
  before: RevisionSnapshot,
  patch: RevisionPatch,
  forecastCount: number,
): RevisionDraft[] {
  if (forecastCount <= 0) return []

  const drafts: RevisionDraft[] = []
  for (const field of REVISION_TRACKED_FIELDS) {
    const next = patch[field]
    if (next === undefined) continue
    if (isSame(before[field], next)) continue
    drafts.push({
      field,
      oldValue: serialize(before[field]),
      newValue: serialize(next),
    })
  }
  return drafts
}

/**
 * ADR-0012：变更冻结字段**必须**给出理由。
 *
 * 返回 `null` 表示通过，否则返回拒绝原因。与 `planRevisions` 同为纯函数，
 * 使这条规则可单测，而不必启动数据库或 tRPC。
 */
export function missingRevisionReason(
  drafts: RevisionDraft[],
  reason: string | undefined,
): string | null {
  if (drafts.length === 0) return null
  if (reason === undefined || reason.trim().length === 0) {
    return `变更已冻结字段（${drafts
      .map((draft) => draft.field)
      .join(" / ")}）必须给出理由（ADR-0012）`
  }
  return null
}
