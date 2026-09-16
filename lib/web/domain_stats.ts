/**
 * 领域读数的统计核心（ADR-0032 / ADR-0033）。
 *
 * 为什么是纯函数：这些数字**没有任何症状**。算错的技能分照样是个数字，照样带着
 * 一个像模像样的区间——所以它必须能被一份合成样本直接钉住（`fixtures/domain_samples.ts`），
 * 而不是必须起一个数据库才能验证。
 *
 * 三条不许被"顺手放宽"的规则：
 *
 * 1. **参照基准率由系统计算**（该领域已结算题的实际发生率），不接受任何外部传入
 *    或按题覆盖（ADR-0032 §二/§五）。
 * 2. **样本不足时不给判据**——阈值以下连字段都不出现，避免下游把噪音当结论展示
 *    （ADR-0033 §六：不得隐藏不确定性，也不得伪造精度）。
 * 3. **随机性可复现**：固定种子的配对 bootstrap，同数据两次运行逐位相同
 *    （ADR-0033 §三；与仓库「门禁只能整片变红」的口径一致）。
 */

import { DomainSample, PendingSample } from "./fixtures/domain_samples"
import { calibrationBinsOf, type CalibrationBin } from "./calibration_bins"

/** 样本类型从这里出口：消费方（router、页面）不必知道 fixture 模块的存在。 */
export type { DomainSample, PendingSample }

/** 样本数阈值：低于它不给技能分与区间（ADR-0032 §四）。 */
export const N_MIN_FOR_VERDICT = 20
/** 样本数阈值：低于它连桶都不给（ADR-0032 §四）。 */
export const N_MIN_FOR_BINS = 5
/** bootstrap 重采样次数与置信水平（ADR-0033 §三）。 */
export const BOOTSTRAP_ITERATIONS = 2000
export const CONFIDENCE_LEVEL = 0.95
/**
 * 固定随机种子。写死在这里、不接受参数：种子可配置等于把"两次运行结果不同"
 * 变成可能，而那是这类判据最容易被当成"数据变了"的失败模式。
 */
export const BOOTSTRAP_SEED = 0x5eed_1234

export type SkillVerdict = "better" | "worse" | "inconclusive"

export type DomainAssessment = {
  domain: string
  /** 计入判据的样本数（ADR-0032 §六：必须透明）。 */
  n: number
  /** 悬空未计入的样本数（ADR-0031 §二）。它进分母，不进判据。 */
  pending: number
  /** 这个前缀的读数**包含其后代标签**（ADR-0030 §十一/§十三）。 */
  includesDescendants: true
  /** n ≥ N_MIN_FOR_BINS 时才有。 */
  bins?: CalibrationBin[]
  resolution?: number
  brier?: number
  brierRef?: number
  /** n ≥ N_MIN_FOR_VERDICT 且 Brier_ref > 0 时才有。 */
  skillScore?: number
  ci?: [number, number]
  verdict?: SkillVerdict
}

/**
 * 确定性伪随机（mulberry32）。不用 `Math.random`：那条路一旦被走进去，
 * 「同数据两次运行结果不同」会以极偶发的形式出现，而偶发失败比稳定失败更难查。
 */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/** Brier：均方误差 `(预测 - 实际结果)²`。注意两个量不是一回事。 */
function brierOf(samples: DomainSample[]): number {
  return mean(samples.map((s) => (s.forecast - s.outcome) ** 2))
}

/** 参照策略（对每条题都押基准率 `p̄`）的 Brier：`(p̄ - 实际结果)²`。 */
function brierRefOf(samples: DomainSample[], baseRate: number): number {
  return mean(samples.map((s) => (baseRate - s.outcome) ** 2))
}

/** 该领域已结算题的实际发生率（= 系统算出来的基准率，ADR-0032 §二）。 */
function baseRateOf(samples: DomainSample[]): number {
  return mean(samples.map((s) => s.outcome))
}

/**
 * 技能分 = 1 - Brier / Brier_ref（ADR-0032 §二）。
 *
 * `Brier_ref` 为 0 时技能分**无定义**（0/0）：那意味着该领域所有题的结果都一样且
 * 基准率恰好等于它——此时"照着基准率押"是零误差，没有任何策略能更好。返回
 * `undefined` 而不是 `Infinity`/`NaN`：JSON 里出现 NaN 会让下游悄悄当成 0。
 */
function skillScoreOf(samples: DomainSample[]): number | undefined {
  const brier = brierOf(samples)
  const brierRef = brierRefOf(samples, baseRateOf(samples))
  if (brierRef === 0) return undefined
  return 1 - brier / brierRef
}

/** 配对 bootstrap（ADR-0033 §三）：有放回重采样"题"，每次重算整个技能分。 */
function bootstrapCi(samples: DomainSample[]): [number, number] | undefined {
  const random = makeRandom(BOOTSTRAP_SEED)
  const scores: number[] = []

  for (let iteration = 0; iteration < BOOTSTRAP_ITERATIONS; iteration++) {
    const resampled: DomainSample[] = []
    for (let index = 0; index < samples.length; index++) {
      const pick = Math.floor(random() * samples.length)
      resampled.push(samples[pick])
    }
    const score = skillScoreOf(resampled)
    // 某次重采样可能把 Brier_ref 采成 0（全是同一种结果）⇒ 那次没有技能分。
    // 丢掉它是对的：不能拿一个无定义的值去排分位数。
    if (score !== undefined) scores.push(score)
  }

  if (scores.length === 0) return undefined
  scores.sort((a, b) => a - b)
  const alpha = (1 - CONFIDENCE_LEVEL) / 2
  const lower = scores[Math.floor(alpha * (scores.length - 1))]
  const upper = scores[Math.ceil((1 - alpha) * (scores.length - 1))]
  return [lower, upper]
}

/**
 * 分辨率：概率有没有把结果区分开（ADR-0032 §三）。
 *
 * 用 Murphy 分解里的那一项：按桶的**实际发生率**相对总体发生率的平方偏差。
 * 「永远押 0.4」的人校准时看起来完美（曲线贴着对角线），但分辨率是 0——这正是
 * 为什么它是与校准并列的第四件读数，而不是可由校准推出来的东西。
 */
function resolutionOf(bins: CalibrationBin[], overallRate: number): number {
  const nonEmpty = bins.filter((bin) => bin.count > 0)
  if (nonEmpty.length === 0) return 0
  return mean(nonEmpty.map((bin) => (bin.meanOutcome - overallRate) ** 2))
}

/** 区间相对 0 的三种表述（ADR-0033 §四）；跨 0 不许有趋势性措辞。 */
function verdictOf(ci: [number, number]): SkillVerdict {
  if (ci[0] > 0) return "better"
  if (ci[1] < 0) return "worse"
  return "inconclusive"
}

/**
 * 计算一份领域读数。
 *
 * `samples` 是**已计入**判据的样本（调用方已按 ADR-0031 §六 过滤掉悬空）；
 * `pending` 只用来报分母，绝不参与任何计算。
 */
export function computeDomainAssessment(
  domain: string,
  samples: DomainSample[],
  pending: PendingSample[],
): DomainAssessment {
  // 排序：bootstrap 的随机序列是按样本顺序消耗的，顺序不稳会让"同数据同结论"
  // 取决于数据库返回行的顺序（那是不确定的）。
  const sorted = [...samples].sort((a, b) =>
    a.questionId < b.questionId ? -1 : a.questionId > b.questionId ? 1 : 0,
  )

  const assessment: DomainAssessment = {
    domain,
    n: sorted.length,
    pending: pending.length,
    includesDescendants: true,
  }

  if (sorted.length < N_MIN_FOR_BINS) return assessment

  const baseRate = baseRateOf(sorted)
  const bins = calibrationBinsOf(sorted, {
    forecastOf: (sample) => sample.forecast,
    outcomeOf: (sample) => sample.outcome,
  })
  assessment.bins = bins
  assessment.resolution = resolutionOf(bins, baseRate)
  assessment.brier = brierOf(sorted)
  assessment.brierRef = brierRefOf(sorted, baseRate)

  if (sorted.length < N_MIN_FOR_VERDICT) return assessment

  const skillScore = skillScoreOf(sorted)
  if (skillScore === undefined) return assessment

  assessment.skillScore = skillScore
  // 区间跨 0 ⇒ 只允许"无法判断方向"（ADR-0033 §四）。verdict 由区间决定，
  // 而不是由点估计的符号决定——点估计的符号在小样本下几乎必然是错的。
  const ci =
    bootstrapCi(sorted) ?? ([skillScore, skillScore] as [number, number])
  assessment.ci = ci
  assessment.verdict = verdictOf(ci)

  return assessment
}
