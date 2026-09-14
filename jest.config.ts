/**
 * For a detailed explanation regarding each configuration property, visit:
 * https://jestjs.io/docs/configuration
 */

import type { Config } from "jest"
import nextJest from "next/jest.js"

const createJestConfig = nextJest({
  dir: "./",
})

const config: Config = {
  clearMocks: true,
  collectCoverage: false,
  coverageDirectory: "coverage",
  testPathIgnorePatterns: ["<rootDir>/e2e/", "<rootDir>/node_modules/"],
  collectCoverageFrom: [
    "**/*.{js,jsx,ts,tsx}",
    "!**/node_modules/**",
    "!**/vendor/**",
    // 构建产物与 e2e 用例不是被测源码：不排除的话报告会被 `.next/` 里的编译产物
    // 稀释（实测 `All files` 因此只有 14.64%），任何全局阈值都会失去意义。
    "!**/.next/**",
    "!**/coverage/**",
    "!**/e2e/**",
  ],
  coverageProvider: "v8",
  coverageThreshold: {
    global: {},
    "./lib/web/resolution.ts": {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50,
    },
    "./lib/_scoring.ts": {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50,
    },
    "./lib/web/llm_parse.ts": {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50,
    },
    // 决策质量层是这一 phase 里逻辑最密的一块（ADR-0019 / ADR-0020），
    // 因此和既有领域模块一样给出覆盖下限，避免回退无人拦。
    "./lib/web/decisions.ts": {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
    "./lib/web/decision_rubric.ts": {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
    "./lib/web/decision_router.ts": {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
    // 校准图的可见面：ADR-0008 的违反在这里**没有症状**（图照常画，只是多算了
    // 未背书样本），所以除了查询结构断言外再给一个下限，防止测试本身烂掉。
    "./pages/api/calibration_graph.ts": {
      branches: 60,
      functions: 60,
      lines: 60,
      statements: 60,
    },
    // 身份分发（ADR-0026）与自举建号（ADR-0022）：错在这里的后果是“以别人的
    // 身份落库”与“静默放开自助注册”，两者都不该靠人眼发现。
    "./cli/context.ts": {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
    "./cli/init.ts": {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  testEnvironment: "jsdom",
}

export default createJestConfig(config)
