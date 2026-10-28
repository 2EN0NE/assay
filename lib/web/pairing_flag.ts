/**
 * 配对码登录的**开关**（ADR-0035）。
 *
 * 为什么这几行要单独一个文件：它是唯一被**浏览器**（`pages/pair.tsx`）导入的配对
 * 模块。`pairing_code.ts` 里有 `node:crypto`（生成与哈希），而 webpack 的客户端
 * 打包解析不了 `node:` 协议——页面即使只在 `getServerSideProps` 里用它，客户端
 * 那一份构建也会失败（实测：`UnhandledSchemeError: Reading from "node:crypto" is not
 * handled by plugins`，整页变成 Build Error）。所以**这个文件必须保持零 `node:` 依赖**，
 * 不要把 `generatePairingCode` / `hashPairingCode` 搬进来。
 *
 * 开关本身是 ADR-0035 的决定，不是配置细节：**默认关闭**，且**不得由 `NODE_ENV` 推断**。
 * 在内网主机上跑 `next dev` 时 `NODE_ENV === "development"`，用它可以推断出"打开"，
 * 那等于给一台服务家人的机器开后门。
 */

export const PAIRING_LOGIN_ENV = "ASSAY_ENABLE_PAIRING_LOGIN"

export function isPairingLoginEnabled(
  env: Record<string, string | undefined>,
): boolean {
  const value = env[PAIRING_LOGIN_ENV]
  return value === "1" || value === "true"
}
