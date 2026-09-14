import prisma from "../lib/prisma"
import { API_KEY_LENGTH } from "../lib/api_key"
import { CliError } from "./args"
import { initOwner } from "./init"

/**
 * `init` 是"没有浏览器也能开始记录"的入口（ADR-0022），因此它是**自助注册**——
 * 护栏与凭据形状都必须被锁住，否则这两条 ACL 只存在于票据的 `[x]` 里。
 */

jest.mock("../lib/prisma", () => ({
  __esModule: true,
  default: {
    user: { count: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
  },
}))

const userCount = jest.mocked(prisma.user.count)
const userFindUnique = jest.mocked(prisma.user.findUnique)
const userCreate = jest.mocked(prisma.user.create)

const created = {
  userId: "user-1",
  email: "owner@localhost",
  apiKey: "printed-once",
}

beforeEach(() => {
  userCount.mockResolvedValue(0)
  userFindUnique.mockResolvedValue(null)
  userCreate.mockResolvedValue({
    id: created.userId,
    email: created.email,
  } as never)
})

describe("initOwner（ADR-0022：CLI 自举建号）", () => {
  it("空库可直接建号：占位邮箱 + 一把新凭据", async () => {
    const result = await initOwner({ label: "owner", allowCreateUser: false })

    expect(result).toEqual({
      userId: "user-1",
      email: "owner@localhost",
      apiKey: expect.any(String),
    })
    // 身份可以没有真实邮箱，但 User.email 必填且唯一 ⇒ 用不会被误当收件地址的占位标识
    expect(userCreate).toHaveBeenCalledWith({
      data: { email: "owner@localhost", apiKey: result.apiKey },
    })
  })

  it("护栏：库里已有身份且未显式放行 ⇒ 拒绝建号，且不落库", async () => {
    userCount.mockResolvedValue(3)

    await expect(
      initOwner({ label: "owner", allowCreateUser: false }),
    ).rejects.toThrow(/拒绝自动建号/)

    expect(userCreate).not.toHaveBeenCalled()
  })

  it("护栏的提示要说清怎么放行——拒绝不是死路", async () => {
    userCount.mockResolvedValue(3)

    const error = await initOwner({
      label: "owner",
      allowCreateUser: false,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(CliError)
    expect((error as CliError).hint).toMatch(/--allow-create-user/)
  })

  it("显式 --allow-create-user 时才放行（护栏不是「空库=唯一条件」）", async () => {
    userCount.mockResolvedValue(3)

    await expect(
      initOwner({ label: "second", allowCreateUser: true }),
    ).resolves.toMatchObject({ email: "second@localhost" })

    expect(userCreate).toHaveBeenCalled()
  })

  it("占位邮箱已被占用 ⇒ 拒绝，并指向轮换而不是覆盖", async () => {
    userFindUnique.mockResolvedValue({ id: "user-9" } as never)

    const error = await initOwner({
      label: "owner",
      allowCreateUser: true,
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(CliError)
    expect((error as CliError).message).toMatch(/已存在/)
    expect(userCreate).not.toHaveBeenCalled()
  })

  it("打印出来的凭据就是落库的那把——它与 Web 轮换是同一种形状（ADR-0021）", async () => {
    const result = await initOwner({ label: "owner", allowCreateUser: false })

    const data = userCreate.mock.calls[0][0] as { data: { apiKey: string } }
    expect(data.data.apiKey).toBe(result.apiKey)
    // 形状读的是 `lib/api_key.ts` 的常量，不是本地再写一遍数字：
    // 常量只有一个定义处，两边才不会各自漂移。
    expect(result.apiKey).toHaveLength(API_KEY_LENGTH)
    expect(result.apiKey).toMatch(/^[0-9a-z]+$/)
  })
})
