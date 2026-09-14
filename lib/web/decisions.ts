/**
 * 决策的叙事字段（ADR-0001 / ADR-0019）。
 *
 * 一个 Decision 承载决策时点的推理：陈述、理由、预期后果、当时已知 / 当时未知。
 * 这些字段**不参与任何评分**——它们的用途是复盘时还原"当时为什么这么想"，
 * 而这恰恰是 ADR-0016 保留叙事（③）的唯一理由：分值告诉你"大概还行"，
 * 叙事才告诉你"当初在怕什么"。
 *
 * 与 ADR-0012 的冻结字段不同，叙事**事后可以补充**：它不进任何分值，
 * 因此补记不产生"把当初说圆"的激励扭曲（锁定的范围见 ADR-0020）。
 */

export type DecisionNarrativeInput = {
  statement: string
  reasoning?: string | null
  expectedOutcome?: string | null
  knownInfo?: string | null
  unknownInfo?: string | null
}

export type DecisionNarrative = {
  statement: string
  reasoning: string | null
  expectedOutcome: string | null
  knownInfo: string | null
  unknownInfo: string | null
}

/** 空串与纯空白统一归一为 `null`：库里不存"填了个空格"这种伪填写。 */
function trimToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null
  }
  const trimmed = value.trim()
  return trimmed === "" ? null : trimmed
}

export function normalizeDecisionNarrative(
  input: DecisionNarrativeInput,
): DecisionNarrative {
  const statement = input.statement.trim()
  if (statement === "") {
    throw new Error("决策陈述不能为空：一个决策必须说清它在决定什么")
  }

  return {
    statement,
    reasoning: trimToNull(input.reasoning),
    expectedOutcome: trimToNull(input.expectedOutcome),
    knownInfo: trimToNull(input.knownInfo),
    unknownInfo: trimToNull(input.unknownInfo),
  }
}

/** 一次**局部**更新：`undefined` = 这次没提这个字段（与 Prisma 的语义一致）。 */
export type DecisionNarrativePatchInput = {
  statement?: string | null
  reasoning?: string | null
  expectedOutcome?: string | null
  knownInfo?: string | null
  unknownInfo?: string | null
}

const OPTIONAL_NARRATIVE_FIELDS = [
  "reasoning",
  "expectedOutcome",
  "knownInfo",
  "unknownInfo",
] as const

/**
 * 归一化一次局部更新，**只包含调用方真正提及的字段**。
 *
 * 与 `normalizeDecisionNarrative`（创建时的全量写入）的关键区别就在这一点：
 * 局部更新不能把没提到的字段写成 `null`——那意味着"改一句话"顺手抹掉另外四栏，
 * 而抹掉是**改写**，本应带理由留痕。改一句话却把一个月的记录清空，是这里最容易
 * 犯而最难发现的错误（更新成功、响应也是 200）。
 */
export function normalizeNarrativePatch(
  input: DecisionNarrativePatchInput,
): Partial<DecisionNarrative> {
  const patch: Partial<DecisionNarrative> = {}

  if (input.statement !== undefined) {
    const statement = (input.statement ?? "").trim()
    if (statement === "") {
      throw new Error("决策陈述不能为空：一个决策必须说清它在决定什么")
    }
    patch.statement = statement
  }

  for (const field of OPTIONAL_NARRATIVE_FIELDS) {
    const value = input[field]
    if (value !== undefined) {
      patch[field] = trimToNull(value)
    }
  }

  return patch
}
