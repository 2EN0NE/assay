/**
 * 诊断日志一律走 stderr。
 *
 * stdout 是 agent CLI 的数据通道（ADR-0015）：一行对 Web 完全无害的 `console.log`
 * 就足以让下游的 `JSON.parse` 崩掉。因此 **CLI 可达的代码不要用 `console.log`**，
 * 用这里的 `log`；CLI 边界还有一道守卫（`cli/args.ts` 的 `installStdoutGuard`）会在
 * 有人写 stdout 时当场报错。
 */
/**
 * 全工程**唯一**的日志出口（AGENTS.md「日志体系」）。诊断一律走 stderr。
 *
 * stdout 是 agent CLI 的**数据通道**（ADR-0015）：一行对 Web 完全无害的 `console.log`
 * 就足以让下游的 `JSON.parse` 崩掉。因此：
 *
 * - 项目代码**不要直接调用 `console.*`**，用这里的 `log` / `warn`（ESLint 的
 *   `no-console` 会拦住）；
 * - `log` 故意用 `console.error`、`warn` 故意用 `console.warn`——在 Node 里**只有这两个
 *   方法写 stderr**，`console.log` / `console.info` 写的是 stdout。浏览器里它们仍是
 *   普通 console 方法，行为不变；
 * - 唯一合法写 stdout 的地方是 `cli/args.ts` 的 `emitJson`，且由 `installStdoutGuard`
 *   守卫：非 `emitJson` 的 stdout 写入会当场抛错。
 *
 * 需要上下文时把来源写进消息本身（例如 Prisma 的 `prisma:info …`），不靠前缀约定。
 */
export function log(...args: unknown[]): void {
  console.error(...args)
}

/** 与 `log` 同一条 stderr 通道，只保留 console 的 warn 级别。 */
export function warn(...args: unknown[]): void {
  console.warn(...args)
}
