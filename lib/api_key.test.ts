import { API_KEY_LENGTH, generateApiKey } from "./api_key"

/**
 * 钥匙的形状是 ADR-0021 的接缝：CLI 的 `init` 与 Web 的轮换必须生成同一种东西。
 *
 * 这条测试记录了一次真实事故：旧实现截断一串**变长**的 `Math.random().toString(36)`，
 * 长度在 18–25 之间浮动（`<= 20` 占 8.41%），于是断言长度的用例以约 1/12 的概率
 * 随机变红——"同一种形状"只是通常成立，而随机变红的门禁等于没有门禁。
 */
describe("generateApiKey（ADR-0021：CLI 与 Web 生成同一种凭据）", () => {
  it("长度恒定，不随随机数的表示长短浮动", () => {
    // 样本量足以让旧实现在这里必然变红（单份 `<= 20` 的概率 8.41%）
    for (let i = 0; i < 500; i++) {
      expect(generateApiKey()).toHaveLength(API_KEY_LENGTH)
    }
  })

  it("字符集是小写 base-36，与既有钥匙同一种字母表", () => {
    for (let i = 0; i < 100; i++) {
      expect(generateApiKey()).toMatch(/^[0-9a-z]+$/)
    }
  })
})
