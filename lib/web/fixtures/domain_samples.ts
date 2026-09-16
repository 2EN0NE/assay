/**
 * 领域读数的合成样本 fixture（ADR-0032/0033）。
 *
 * 为什么随代码入库而不是写在测试里：这些数字是**判据本身**的样子。断言
 * 「技能分为负」需要一份**已知更差**的样本；断言「全押基准率 ⇒ 技能分为 0」
 * 需要一份**构造上必然为 0** 的样本。手写散落在测试体里，下一个人改断言时
 * 会顺手改数据，于是判据就不再被钉住了。
 *
 * 每条样本 = 一条题上一个 Owner 的读数（该 Owner 已背书预测的均值，
 * 与 `lib/_scoring.ts` 对同一条题取均值的口径一致）。
 *
 * 特征（故意各不相同，好让"数字算错了"能立刻看出来）：
 *
 * | 领域                 | n  | 特征                                   | 期望        |
 * | -------------------- | -- | -------------------------------------- | ----------- |
 * | 投资/宏观            | 40 | 校准良好且信息量大（0.9 组实际 18/20，0.1 组实际 2/20） | 区间不跨 0（better） |
 * | 投资/公司业绩        | 24 | 过度自信（一律 0.9，实际 12/24）         | 区间不跨 0（worse） |
 * | 投资/估值与价格      | 20 | **每条都押领域基准率本身**（0.5，实际 10/20） | 技能分 == 0 且区间跨 0 |
 * | 投资/交易水平        | 3  | 样本不足 < 5                            | 不给桶、不给技能分 |
 *
 * 「校准良好」那一支故意做得**信号很强**（n=40 且预测极端）：ADR-0033 §四 的三种
 * 表述（better / worse / inconclusive）都要有一条用例钉住，而信号弱的样本只能
 * 诚实地给出 inconclusive——那样 better 这一支就没人测了。
 *
 * 另有 4 条**悬空**样本（ADR-0031）：不进判据，但必须进分母。
 */

export type DomainSample = {
  questionId: string
  /** 该 Owner 在这条题上已背书预测的均值（一条题一个样本）。 */
  forecast: number
  /** 结算结果：YES = 1，NO = 0。 */
  outcome: 0 | 1
}

export type PendingSample = {
  questionId: string
}

export type DomainFixture = {
  domain: string
  samples: DomainSample[]
  /** 悬空未计入的样本（ADR-0031 §二）。必须有，否则分母透明性没法测。 */
  pending: PendingSample[]
}

/** 校准良好且信息量大：0.9 组 20 条里实际发生 18 次；0.1 组 20 条里实际 2 次。 */
function wellCalibratedMacro(): DomainSample[] {
  const high = Array.from({ length: 20 }, (_, index) => ({
    questionId: `macro-high-${String(index + 1).padStart(2, "0")}`,
    forecast: 0.9,
    outcome: (index < 18 ? 1 : 0) as 0 | 1,
  }))
  const low = Array.from({ length: 20 }, (_, index) => ({
    questionId: `macro-low-${String(index + 1).padStart(2, "0")}`,
    forecast: 0.1,
    outcome: (index < 2 ? 1 : 0) as 0 | 1,
  }))
  return [...high, ...low]
}

/** 过度自信：一律押 0.9，实际一半发生。 */
function overconfidentEarnings(): DomainSample[] {
  return Array.from({ length: 24 }, (_, index) => ({
    questionId: `earnings-${String(index + 1).padStart(2, "0")}`,
    forecast: 0.9,
    outcome: (index % 2 === 0 ? 1 : 0) as 0 | 1,
  }))
}

/**
 * 全押基准率：每条都押 0.5、实际恰好 4/8 ⇒ 基准率也是 0.5。
 *
 * 这让 `Brier` 与 `Brier_ref` **按构造相等**，因此技能分必须**恰好为 0**。
 * 这是 ADR-0032/0033 那条自证用例的载体：一旦参照逻辑被去掉或写错
 * （比如拿 0.5 当常数基准率去算别的领域），这里会变红。
 */
function atBaseRateValuation(): DomainSample[] {
  return Array.from({ length: 20 }, (_, index) => ({
    questionId: `valuation-${String(index + 1).padStart(2, "0")}`,
    forecast: 0.5,
    outcome: (index < 10 ? 1 : 0) as 0 | 1,
  }))
}

/** 样本不足：3 条 < N_MIN_FOR_BINS。 */
function tooFewTrading(): DomainSample[] {
  return [
    { questionId: "trading-01", forecast: 0.7, outcome: 1 },
    { questionId: "trading-02", forecast: 0.7, outcome: 0 },
    { questionId: "trading-03", forecast: 0.3, outcome: 0 },
  ]
}

export const DOMAIN_FIXTURE: DomainFixture[] = [
  {
    domain: "投资/宏观",
    samples: wellCalibratedMacro(),
    pending: [
      { questionId: "macro-dangling-01" },
      { questionId: "macro-dangling-02" },
    ],
  },
  {
    domain: "投资/公司业绩",
    samples: overconfidentEarnings(),
    pending: [{ questionId: "earnings-dangling-01" }],
  },
  {
    domain: "投资/估值与价格",
    samples: atBaseRateValuation(),
    pending: [],
  },
  {
    domain: "投资/交易水平",
    samples: tooFewTrading(),
    pending: [{ questionId: "trading-dangling-01" }],
  },
]

export function fixtureFor(domain: string): DomainFixture {
  const found = DOMAIN_FIXTURE.find((entry) => entry.domain === domain)
  if (!found) throw new Error(`fixture 里没有这个领域：${domain}`)
  return found
}
