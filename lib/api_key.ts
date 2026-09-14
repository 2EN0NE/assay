/**
 * API 钥匙的生成。
 *
 * 放在这里而不是某一个 router 里：这把钥匙是**身份**的载体（ADR-0021），
 * Web 的轮换与 CLI 的 init 必须生成同一种东西——否则同一个人的两把钥匙
 * 会有两种形状，而"看起来像钥匙"正是它们唯一的共同点。
 *
 * 长度必须由生成侧**保证**，不能靠"截断一串变长的随机数"碰运气：
 * `Math.random().toString(36)` 的位数随取到的值浮动，旧实现（两次 `slice(2, 15)`
 * 拼接）实测长度落在 18–25 之间、`<= 20` 占 8.41%——于是"同一种形状"只是通常成立，
 * 断言它的测试会以约 1/12 的概率随机变红。形状只有一个定义处：下面的常量。
 */
export const API_KEY_LENGTH = 26

const API_KEY_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz"

export function generateApiKey(): string {
  let key = ""
  for (let i = 0; i < API_KEY_LENGTH; i++) {
    key += API_KEY_ALPHABET[Math.floor(Math.random() * API_KEY_ALPHABET.length)]
  }
  return key
}
