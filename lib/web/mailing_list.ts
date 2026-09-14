import { warn } from "../_log"

/**
 * 订阅邮件列表是**营销副作用**：它失败绝不能影响注册本身。
 *
 * 早先注册流程里是裸的 `void subscribeToMailingList(...)`——一旦这个 Promise 被拒，
 * 就成了 unhandledRejection，而 Next dev 会为它弹出全屏错误层盖住整个页面
 * （e2e 因此全线失败）。
 *
 * 之所以抽成一个函数而不是就地写 catch：这条"失败也不许把注册带崩"的性质必须能
 * 被断言，而内联的 catch 无法在不加载整个 NextAuth 配置的前提下被测到。
 * `subscribe` 作为参数注入，测试因此不需要真的发 HTTP 请求。
 */
export async function subscribeToMailingListSafely(
  subscribe: (email: string, name?: string) => Promise<unknown>,
  email: string,
  name?: string,
): Promise<void> {
  try {
    await subscribe(email, name)
  } catch (error: unknown) {
    warn(
      `订阅邮件列表失败（不影响注册）：${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}
