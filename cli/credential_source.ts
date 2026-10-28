/**
 * 凭据来源（ADR-0026 / ADR-0036）——类型与判据都放在这个**叶子模块**里。
 *
 * 为什么不留在 `cli/context.ts`：那个文件 import prisma 与 NextAuth 适配器，于是任何
 * 只想问一句"这个来源算不算凭据"的地方（`cli/commands.ts`，它的单测不 mock prisma）
 * 都会被迫把整个运行栈拖进来——实测后果是 `PrismaClient is unable to run in this
 * browser environment`。同 `lib/web/pairing_flag.ts` 被拆出来的理由：纯规则不该被
 * 绑在需要运行时的模块上。
 */

/**
 * 身份来源（ADR-0026）。`none` 只用于"自己解决身份"的命令（如 init）：
 * 那一刻确实还没有身份，不是占位值。
 */
export type CredentialSource =
  | "api-key-flag"
  | "api-key-env"
  | "api-key-file"
  | "email-env"
  | "none"

/**
 * 这个来源**真的持有钥匙**吗（ADR-0035）。
 *
 * 写成一个具名判定而不是在每个调用点列三个字符串：来源加新值时，这里必须表态；
 * 而判据写成"不等于 email-env 且不等于 none"的话，新来源会被默默当成凭据。
 *
 * `email-env` 不在其中——`ASSAY_AGENT_USER_EMAIL` 是**身份选择器**（ADR-0021）：
 * 它不含任何秘密，本机谁设了都能以该身份跑命令。它够做业务动作，但证明不了「持有」。
 */
export function isCredentialSource(source: CredentialSource): boolean {
  return (
    source === "api-key-flag" ||
    source === "api-key-env" ||
    source === "api-key-file"
  )
}
