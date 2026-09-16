/**
 * 校准分桶：**一处定义**（10 等宽，[0-10%) … [90-100%)）。
 *
 * 为什么值得单独一个模块：这里原先有**两份**实现——领域读数里那份自述"与校准图同
 * 口径"，而这个"同口径"是靠人记着的。两份只要有一边被改（比如桶数、钳位、空桶填
 * 什么），同一个人就会在"领域读数"和"校准图"里看到不同的形状，而且**不报错**。
 * 漂移的方向恰好是让人相信一个与被评者无关的数，所以这里只留一份。
 */

export type CalibrationBin = {
  binCenter: number
  meanPrediction: number
  meanOutcome: number
  count: number
}

export const NUM_BINS = 10

/**
 * 满仓预测（`forecast === 1`）必须落进**最后一格**。
 * 少了这个钳位，`floor(1 * 10) = 10` 会越界——指向第 11 个不存在的桶。
 */
export function binIndexOf(value: number): number {
  if (value >= 1) return NUM_BINS - 1
  return Math.floor(value * NUM_BINS)
}

/**
 * `outcomeOf` 必须给 0/1。两处调用方各自把结果折算成 0/1：
 * 领域读数的样本直接带 `outcome`，校准图用 `resolution === YES` 折算。
 *
 * 空桶的 `meanOutcome` 是 **NaN 而不是 0**：把"没有样本"画成 0 会让曲线在空桶处
 * 凭空掉到谷底，而那看起来像"校准得很差"。
 */
export function calibrationBinsOf<T>(
  items: readonly T[],
  {
    forecastOf,
    outcomeOf,
  }: {
    forecastOf: (item: T) => number
    outcomeOf: (item: T) => number
  },
): CalibrationBin[] {
  const buckets: T[][] = Array.from({ length: NUM_BINS }, () => [])
  for (const item of items) {
    buckets[binIndexOf(forecastOf(item))].push(item)
  }

  return buckets.map((bucket, index) => {
    const binCenter = (index + 0.5) / NUM_BINS
    const count = bucket.length
    const meanOf = (pick: (item: T) => number) =>
      bucket.reduce((sum, item) => sum + pick(item), 0) / count

    return {
      binCenter,
      meanPrediction: count > 0 ? meanOf(forecastOf) : binCenter,
      meanOutcome: count > 0 ? meanOf(outcomeOf) : Number.NaN,
      count,
    }
  })
}
