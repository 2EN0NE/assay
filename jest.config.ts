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
  },
  testEnvironment: "jsdom",
}

export default createJestConfig(config)
