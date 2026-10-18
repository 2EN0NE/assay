import fs from "node:fs"
import path from "node:path"
import { PAIRING_LOGIN_ENV, isPairingLoginEnabled } from "./pairing_flag"

/**
 * 配对码登录的开关（ADR-0035）。三条性质都不能靠"看起来对"：它在页面与 CLI 两侧
 * 共用，读错一处就会在没人注意的方向上把门打开或关死。
 */
describe("开关默认关闭，且只认显式赋值", () => {
  it("什么都不设 ⇒ 关", () => {
    expect(isPairingLoginEnabled({})).toBe(false)
  })

  it("只设 NODE_ENV（哪怕 development）⇒ 仍然是关", () => {
    expect(isPairingLoginEnabled({ NODE_ENV: "development" })).toBe(false)
    expect(isPairingLoginEnabled({ NODE_ENV: "production" })).toBe(false)
  })

  it("显式设为 1 / true ⇒ 开；其它取值一律算关，不猜", () => {
    expect(isPairingLoginEnabled({ [PAIRING_LOGIN_ENV]: "1" })).toBe(true)
    expect(isPairingLoginEnabled({ [PAIRING_LOGIN_ENV]: "true" })).toBe(true)

    for (const value of ["0", "false", "yes", "on", ""]) {
      expect(isPairingLoginEnabled({ [PAIRING_LOGIN_ENV]: value })).toBe(false)
    }
  })
})

/**
 * 这条守的是**整页构建**：`pages/pair.tsx` 会把这个模块打进客户端那一份 bundle，
 * 而 webpack 解析不了 `node:` 协议——一旦有人把 `node:crypto` 之类搬进来，页面会
 * 整个变成 "Build Error"（实测过一次：`UnhandledSchemeError: Reading from
 * "node:crypto" is not handled by plugins`），而单测全绿。
 */
it("这个模块必须保持零 node: 依赖（它会被浏览器打包）", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "pairing_flag.ts"),
    "utf8",
  )

  // 只看**真的 import 行**：本文件的注释里就写着 `Reading from "node:crypto"`
  // 这句报错原文，用 `/from\s+"node:/` 会命中注释（自己撞过一次）。
  expect(source).not.toMatch(/^\s*import[^\n]*from\s+"node:/m)
})
