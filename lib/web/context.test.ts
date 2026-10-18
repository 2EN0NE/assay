import { getServerSession } from "next-auth"
import { createContext } from "./context"

/**
 * HTTP 路径**只能**产出 `authentication: "session"`（ADR-0035）。
 *
 * 这一行是整个「凭据 vs 会话」区分的落脚点：`credentialProcedure` 只认
 * `"credential"`，而网页侧永远是会话，于是"网页会话签不出配对码"成立。反过来，
 * 若哪天有人把这格删掉或改成别的值，过程层的门就通了——而**没有任何症状**：
 * 单据照常记录，只是网页会话多了一项只有持凭据者才该有的能力。所以这里直接断言它。
 */
jest.mock("next-auth", () => ({
  __esModule: true,
  getServerSession: jest.fn(),
}))

// 真实的 authOptions 会拉起 PrismaAdapter（浏览器版 PrismaClient 在测试里跑不了）；
// 这里只关心 context 怎么读它的结果。
jest.mock("../../pages/api/auth/[...nextauth]", () => ({
  __esModule: true,
  authOptions: {},
}))

const getSession = jest.mocked(getServerSession)

describe("createContext —— 网页侧永远是会话，不是凭据", () => {
  it("已登录：userId 来自会话，认证种类恒为 session", async () => {
    getSession.mockResolvedValue({ user: { id: "user-1" } } as never)

    await expect(createContext({ req: {}, res: {} } as never)).resolves.toEqual(
      {
        session: { user: { id: "user-1" } },
        userId: "user-1",
        authentication: "session",
      },
    )
  })

  it("未登录：没有 userId，但**仍然**是 session（匿名不是凭据）", async () => {
    getSession.mockResolvedValue(null)

    await expect(createContext({ req: {}, res: {} } as never)).resolves.toEqual(
      {
        session: null,
        userId: undefined,
        authentication: "session",
      },
    )
  })
})
