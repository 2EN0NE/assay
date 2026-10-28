import {
  PAIRING_CODE_LENGTH,
  PAIRING_CODE_TTL_MS,
  createFailureLimiter,
  generatePairingCode,
  hashPairingCode,
  isLocalRequest,
  normalizePairingCode,
} from "./pairing_code"

/**
 * ADR-0035：配对码是**一次性短秘密**，它的每一条性质（形状、时效、开关、兑换范围、
 * 失败限流）都错了都没有症状——码照发、页面照转，只是那扇门比设计的更宽。
 * 所以这些规则放在一个不碰 prisma / next 的纯模块里，逐条钉住。
 */

describe("配对码的形状", () => {
  it("长度固定，且不含 0/O、1/I/L 这些在终端里会看错的字符", () => {
    const codes = Array.from({ length: 200 }, () => generatePairingCode())

    for (const code of codes) {
      expect(code).toHaveLength(PAIRING_CODE_LENGTH)
      expect(code).toMatch(/^[2-9A-HJ-NP-Z]+$/)
    }
    // 不要求 200 次全不重复（那是概率断言，会随机变红）；但全同一个码说明
    // "随机"根本没发生——这是唯一值得断言的极端。
    expect(new Set(codes).size).toBeGreaterThan(1)
  })

  it("归一化：大小写、空格与连字符都不影响是同一个码", () => {
    expect(normalizePairingCode("abcd-efgh")).toBe("ABCDEFGH")
    expect(normalizePairingCode(" a b c d e f g h ")).toBe("ABCDEFGH")
    expect(normalizePairingCode("ABCDEFGH")).toBe("ABCDEFGH")
  })

  it("哈希只认归一化后的码：手写时的大小写差异不该变成「码无效」", () => {
    expect(hashPairingCode("abcd-EFGH")).toBe(hashPairingCode("ABCDEFGH"))
  })

  it("哈希不落明文（库里不该出现码本身）", () => {
    const code = "ABCD2345"
    expect(hashPairingCode(code)).not.toBe(code)
    expect(hashPairingCode(code)).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe("时效：短时效（ADR-0035 定的 10 分钟）", () => {
  it("不管实现怎么改，时效都是 10 分钟这一档，不允许被悄悄放大", () => {
    expect(PAIRING_CODE_TTL_MS).toBe(10 * 60 * 1000)
  })
})

describe("兑换范围只限实例本机（loopback）", () => {
  const local = (overrides: Record<string, unknown>) => ({
    socket: { remoteAddress: "127.0.0.1" },
    headers: { host: "localhost:3000" },
    ...overrides,
  })

  it("连接来自回环地址、且浏览器访问的就是回环主机名 ⇒ 可兑换", () => {
    expect(isLocalRequest(local({}))).toBe(true)
    expect(
      isLocalRequest(
        local({
          socket: { remoteAddress: "::1" },
          headers: { host: "127.0.0.1:3000" },
        }),
      ),
    ).toBe(true)
    // Node 在双栈监听下把 IPv4 回环报成映射地址
    expect(
      isLocalRequest(
        local({
          socket: { remoteAddress: "::ffff:127.0.0.1" },
          headers: { host: "[::1]:3000" },
        }),
      ),
    ).toBe(true)
  })

  it("连接不是回环（另一台机器上的浏览器）⇒ 拒绝", () => {
    expect(
      isLocalRequest(local({ socket: { remoteAddress: "192.168.1.20" } })),
    ).toBe(false)
  })

  it("连接看似回环、但浏览器访问的是别的主机名 ⇒ 拒绝（反代会让前面那条失效）", () => {
    expect(
      isLocalRequest(local({ headers: { host: "mac-mini.local:3000" } })),
    ).toBe(false)
    expect(
      isLocalRequest(local({ headers: { host: "assay.example.com" } })),
    ).toBe(false)
  })

  it("缺 host（HTTP/1.0 或畸形请求）⇒ 拒绝：判不出来时不开门", () => {
    expect(isLocalRequest({ socket: { remoteAddress: "127.0.0.1" } })).toBe(
      false,
    )
    expect(isLocalRequest({ headers: { host: "localhost" } })).toBe(false)
  })

  it("Host 取第一个值，端口有没有都算同一个主机", () => {
    expect(
      isLocalRequest(local({ headers: { host: ["localhost:3000", "x"] } })),
    ).toBe(true)
    expect(isLocalRequest(local({ headers: { host: "LOCALHOST:3000" } }))).toBe(
      true,
    )
  })
})

describe("失败限流（ADR-0035：失败限流）", () => {
  const t0 = new Date("2026-10-13T00:00:00Z")
  const later = (ms: number) => new Date(t0.getTime() + ms)

  it("连续失败到上限后封锁，且以**第一次失败**为窗口起点", () => {
    const limiter = createFailureLimiter(3, 10 * 60 * 1000)

    expect(limiter.isBlocked("127.0.0.1", t0)).toBe(false)
    limiter.recordFailure("127.0.0.1", t0)
    limiter.recordFailure("127.0.0.1", later(1000))
    expect(limiter.isBlocked("127.0.0.1", later(2000))).toBe(false)

    limiter.recordFailure("127.0.0.1", later(2000))
    expect(limiter.isBlocked("127.0.0.1", later(3000))).toBe(true)
  })

  it("窗口过后自动解封（失败计数不是永久的）", () => {
    const limiter = createFailureLimiter(1, 10 * 60 * 1000)

    limiter.recordFailure("127.0.0.1", t0)
    expect(limiter.isBlocked("127.0.0.1", t0)).toBe(true)
    expect(limiter.isBlocked("127.0.0.1", later(10 * 60 * 1000))).toBe(false)
  })

  it("限流按来源分开：一个来源被打满不影响另一个", () => {
    const limiter = createFailureLimiter(1, 10 * 60 * 1000)

    limiter.recordFailure("127.0.0.1", t0)
    expect(limiter.isBlocked("127.0.0.1", t0)).toBe(true)
    expect(limiter.isBlocked("::1", t0)).toBe(false)
  })
})
