import prisma from "../prisma"
import { PAIRING_CODE_TTL_MS, hashPairingCode } from "./pairing_code"
import { issuePairingCode, redeemPairingCode } from "./pairing_code_store"

/**
 * 配对码的落库部分（ADR-0035）。
 *
 * 这里只有两条性质真正要紧，而且**错了都没有症状**：
 * 1. 库里的哈希必须能由"人实际打出来的那种写法"命中（归一化只做一次就等于没做）；
 * 2. 一次有效必须由**带条件的更新**保证，不能是"先查再改"——否则并发的两次兑换
 *    会双双成功，而那是肉眼看不见的。
 */
jest.mock("../prisma", () => ({
  __esModule: true,
  default: {
    pairingCode: {
      deleteMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
    },
  },
}))

const pairingCode = jest.mocked(prisma.pairingCode)

const NOW = new Date("2026-10-13T12:00:00Z")

beforeEach(() => {
  pairingCode.deleteMany.mockResolvedValue({ count: 0 })
  pairingCode.create.mockResolvedValue({} as never)
  pairingCode.updateMany.mockResolvedValue({ count: 0 })
  pairingCode.findUnique.mockResolvedValue(null)
})

describe("issuePairingCode —— 签发", () => {
  it("库里落的是哈希而不是码本身，且到期时间是 now + 10 分钟", async () => {
    const issued = await issuePairingCode("user-1", NOW)

    expect(issued.expiresAt).toEqual(
      new Date(NOW.getTime() + PAIRING_CODE_TTL_MS),
    )
    expect(pairingCode.create).toHaveBeenCalledTimes(1)
    const data = pairingCode.create.mock.calls[0][0]?.data

    expect(data.userId).toBe("user-1")
    expect(data.codeHash).toBe(hashPairingCode(issued.code))
    // 明文不得以任何形式落库
    expect(JSON.stringify(data)).not.toContain(issued.code)
  })

  it("签发前清掉**这个身份自己已过期**的码：用过的也清，未过期的与别人的不动", async () => {
    await issuePairingCode("user-1", NOW)

    // 不限 `usedAt`：只删未用过的行等于让每次签发都留下一条永久记录（表一直长）。
    expect(pairingCode.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", expiresAt: { lte: NOW } },
    })
  })
})

describe("redeemPairingCode —— 一次有效", () => {
  it("用带条件的更新领取：只认未用过、且尚未过期的码", async () => {
    pairingCode.updateMany.mockResolvedValue({ count: 1 })
    pairingCode.findUnique.mockResolvedValue({ userId: "user-1" } as never)

    await expect(redeemPairingCode("abcd-2345", NOW)).resolves.toBe("user-1")

    expect(pairingCode.updateMany).toHaveBeenCalledWith({
      where: {
        codeHash: hashPairingCode("abcd-2345"),
        usedAt: null,
        expiresAt: { gt: NOW },
      },
      data: { usedAt: NOW },
    })
  })

  it("已经被领过（count = 0）⇒ 拿不到身份，也不再去查它是谁的", async () => {
    pairingCode.updateMany.mockResolvedValue({ count: 0 })

    await expect(redeemPairingCode("abcd-2345", NOW)).resolves.toBeNull()
    expect(pairingCode.findUnique).not.toHaveBeenCalled()
  })

  it("码不存在 / 已过期（count = 0）⇒ 同样是 null，不区分失败原因", async () => {
    pairingCode.updateMany.mockResolvedValue({ count: 0 })

    await expect(redeemPairingCode("ZZZZ9999", NOW)).resolves.toBeNull()
  })

  it("领取用的是归一化后的哈希：大小写与连字符不影响结果", async () => {
    pairingCode.updateMany.mockResolvedValue({ count: 1 })
    pairingCode.findUnique.mockResolvedValue({ userId: "user-1" } as never)

    await redeemPairingCode("ABCD-2345", NOW)

    expect(pairingCode.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          codeHash: hashPairingCode("abcd2345"),
        }),
      }),
    )
  })

  it("行还在、但查不到用户（并发删除）⇒ 退回 null，不抛异常", async () => {
    pairingCode.updateMany.mockResolvedValue({ count: 1 })
    pairingCode.findUnique.mockResolvedValue(null)

    await expect(redeemPairingCode("abcd-2345", NOW)).resolves.toBeNull()
  })
})
