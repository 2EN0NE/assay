import type { DecisionNarrative } from "./decisions"

/**
 * 修订留痕（ADR-0012）。
 *
 * 已冻结字段（结算判据 / 期限 / 评分锚点）**可改，但必留痕**。留痕之所以够用，
 * 是因为 Resolution Drift 的杀伤力来自**无声**——一旦"我改过判据"被记录下来，
 * 它本身就成了复盘材料。
 *
 * 唯一的例外：**首次 Forecast 之前**的改动不算修订。那时还没有任何信念被记录，
 * 改动无漂移可言，纯粹是修文字。
 *
 * 同一机制也承载 **Decision 叙事字段**的改写（ADR-0020）：同样"可改、必留痕"，
 * 但例外不同——叙事没有 Forecast 可等，例外是"给**空白**字段补写"不算改写。
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
 *
 * 入参只要求"有一个可打印的字段名"：Question 的冻结字段与 Decision 的叙事字段
 * 是两套词汇表，而"改了就必须给理由"是同一条规则——两处各写一遍就会在两处各
 * 松一次口。
 */
export function missingRevisionReason(
  drafts: { field: string }[],
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

/** Decision 叙事字段：ADR-0012 的同一机制（ADR-0020 把它扩到叙事）。 */
export const NARRATIVE_TRACKED_FIELDS = [
  "statement",
  "reasoning",
  "expectedOutcome",
  "knownInfo",
  "unknownInfo",
] as const

export type NarrativeTrackedField = (typeof NARRATIVE_TRACKED_FIELDS)[number]

export type NarrativeRevisionDraft = {
  field: NarrativeTrackedField
  oldValue: string | null
  newValue: string | null
}

/**
 * 纯函数：算出这次叙事改动应当留下哪些修订记录（ADR-0012 × ADR-0020）。
 *
 * 只对"**已填写的**内容被改写或清空"产生草稿：
 *
 * - `undefined` = 这次没提这个字段 ⇒ 不动它，也就不产生修订（局部更新的前提）；
 * - 值没变 ⇒ 没什么可留痕的；
 * - 原来为空、现在填上 ⇒ **补写**，不是改写。当初就没记，记上它不产生
 *   "把当初说圆"的激励扭曲，而要求它为每一笔补写交代理由，只会让人宁可不补；
 * - 其余（原值非空且变了，包括被清空）⇒ 改写，必须留痕。
 */
export function planNarrativeRevisions(
  before: DecisionNarrative,
  patch: Partial<DecisionNarrative>,
): NarrativeRevisionDraft[] {
  const drafts: NarrativeRevisionDraft[] = []
  for (const field of NARRATIVE_TRACKED_FIELDS) {
    const next = patch[field]
    if (next === undefined) continue

    const previous = before[field]
    if (previous === next) continue
    if (previous === null) continue

    drafts.push({ field, oldValue: previous, newValue: next })
  }
  return drafts
}
