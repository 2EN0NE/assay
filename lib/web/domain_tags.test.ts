// 领域名的规则是纯函数，但所测模块同时含数据库操作（它导出传播与解析）。
// 把 prisma 掉成一个空壳，让这组用例只测规则，不拉起真实客户端（jsdom 下拉不起来）。
jest.mock("../prisma", () => ({ __esModule: true, default: {} }))

import { assertValidDomainName, normalizeDomainName } from "./domain_tags"

/**
 * 领域名规则的守卫（ADR-0030 §十二）。
 *
 * 存在理由：这些规则的价值全在"非法输入会报错"上。一旦某个校验退化成静默清洗，
 * 用户会以为他标的是另一个领域，而库里那个桶的名字与他以为的不一样——没有任何
 * 报错，只是分桶结果慢慢变得不可解释。
 */
describe("领域名：规范化与校验（ADR-0030 §十二）", () => {
  it("判重折叠大小写（CPI 与 cpi 是同一个领域），显示仍保留原样", () => {
    expect(normalizeDomainName("CPI")).toBe("cpi")
    expect(normalizeDomainName("cpi")).toBe("cpi")
    expect(normalizeDomainName("投资/宏观/CPI")).toBe("投资/宏观/cpi")
    expect(assertValidDomainName("CPI")).toBe("CPI")
  })

  it("去掉首尾空白", () => {
    expect(normalizeDomainName("  投资/宏观  ")).toBe("投资/宏观")
  })

  it("拒绝空格，而不是静默清洗成别的名字", () => {
    expect(() => assertValidDomainName("投资 宏观")).toThrow(/空格/)
  })

  it("拒绝纯数字", () => {
    expect(() => assertValidDomainName("2026")).toThrow(/非数字/)
    expect(assertValidDomainName("投资/2026")).toBe("投资/2026")
  })

  it("拒绝以 / 开头/结尾或有空层", () => {
    expect(() => assertValidDomainName("/投资")).toThrow(/层级/)
    expect(() => assertValidDomainName("投资/")).toThrow(/层级/)
    expect(() => assertValidDomainName("投资//宏观")).toThrow(/层级/)
  })

  it("允许中文、数字、_ 与 -，以及 / 分层", () => {
    for (const name of [
      "投资/宏观",
      "投资/公司业绩-Q3",
      "投资/估值与价格",
      "投资/交易水平_v2",
    ]) {
      expect(assertValidDomainName(name)).toBe(name)
    }
  })

  it("拒绝空名", () => {
    expect(() => assertValidDomainName("   ")).toThrow(/不能为空/)
  })
})
