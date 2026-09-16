import { binIndexOf, calibrationBinsOf, NUM_BINS } from "./calibration_bins"

/**
 * 校准分桶（一处定义，两个消费者：领域读数与校准图）。
 *
 * 这些断言存在的理由：两个消费者算出来的形状**必须**一样，而"不一样"不会有任何
 * 症状——只是同一个人在两处看到不同的桶。
 */

const sample = (forecast: number, outcome: number) => ({ forecast, outcome })
const binsOf = (samples: { forecast: number; outcome: number }[]) =>
  calibrationBinsOf(samples, {
    forecastOf: (s) => s.forecast,
    outcomeOf: (s) => s.outcome,
  })

it("满仓预测落进最后一格，不越界（少了钳位会指向第 11 个不存在的桶）", () => {
  expect(binIndexOf(1)).toBe(NUM_BINS - 1)
  expect(binIndexOf(0.999)).toBe(NUM_BINS - 1)
  expect(binIndexOf(0)).toBe(0)

  const bins = binsOf([sample(1, 1)])
  expect(bins).toHaveLength(NUM_BINS)
  expect(bins[NUM_BINS - 1].count).toBe(1)
})

it("边界落在下半格：[0-10%) 含 0 不含 0.1", () => {
  const bins = binsOf([sample(0, 1), sample(0.099, 0)])
  expect(bins[0].count).toBe(2)
  expect(bins[1].count).toBe(0)

  const shifted = binsOf([sample(0.1, 1)])
  expect(shifted[0].count).toBe(0)
  expect(shifted[1].count).toBe(1)
})

it("空桶的 meanOutcome 是 NaN 而不是 0（画成 0 等于凭空掉到谷底）", () => {
  const bins = binsOf([sample(0.5, 1)])

  expect(bins[5].count).toBe(1)
  expect(bins[5].meanOutcome).toBe(1)

  expect(bins[0].count).toBe(0)
  expect(bins[0].meanOutcome).toBeNaN()
  // 空桶的 meanPrediction 用桶心：它代表"这一格没有读数"，不是 0。
  expect(bins[0].meanPrediction).toBe(bins[0].binCenter)
})

it("每格用桶心定位（[90-100%) 的桶心是 0.95）", () => {
  const bins = binsOf([])
  expect(bins[0].binCenter).toBeCloseTo(0.05)
  expect(bins[NUM_BINS - 1].binCenter).toBeCloseTo(0.95)
})
