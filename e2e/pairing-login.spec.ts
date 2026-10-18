import { expect, test } from "@playwright/test"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

/**
 * ADR-0035 的第二扇门：**CLI 签发 → 浏览器兑换 → 这个身份真的拿到会话**。
 *
 * 为什么这必须是一条 e2e 而不是几个单测：这条路径的每一半单独看都对，合起来才是
 * 有价值的东西——签发在 CLI（**另一个进程**）、兑换在 Next 服务、会话最终由 NextAuth
 * 读出来。cookie 的名字或选项写错一个字节时，界面会显示"登录成功"，而
 * `/api/auth/session` 仍然是空的（`lib/web/session_cookie.ts` 的注释说的就是这件事）。
 * 单测各自锁得住一半，只有这里能验"两半拼起来成立"。
 *
 * 用的身份是 `init` 建出的 `<label>@localhost`——这**正是** ADR-0035 要解决的场景：
 * 域名不带点的地址走邮件门会被拒（`error=EmailSignin`），而配对码这条路与邮箱无关。
 */
async function runCli(
  args: string[],
  env: Record<string, string>,
): Promise<string> {
  // `--silent` 不可省：不加时 npm 会把 "> agent" 之类的横幅写进 stdout，
  // 下游的 JSON.parse 会直接崩掉（ADR-0015 的 stdout 契约）。
  const { stdout } = await execFileAsync(
    "npm",
    ["run", "--silent", "agent", "--", ...args],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        // 挡住 `.env` 里可能存在的钥匙与凭据文件：这次用例的身份只能是下面这一把
        // （dotenv 不覆盖已存在的键，空串因此是"显式压制"）。
        FATEBOOK_AGENT_API_KEY: "",
        FATEBOOK_AGENT_API_KEY_FILE: "",
        FATEBOOK_AGENT_USER_EMAIL: "",
        // CLI 侧的开关判定与 Web 侧共用一份定义；这里显式打开。
        // Web 服务端的开关由 `npm run dev:e2e` 提供（默认关闭是 ADR-0035 的决定）。
        FATEBOOK_ENABLE_PAIRING_LOGIN: "1",
        ...env,
      },
      maxBuffer: 10 * 1024 * 1024,
    },
  )
  return stdout
}

test("配对码：CLI 签发 → 本机浏览器兑换 → 该身份拿到会话，且只能兑换一次（ADR-0035）", async ({
  page,
  context,
}) => {
  // 1) 造一个**走不了邮件门**的身份：`<label>@localhost` 不带点
  const label = `pairing-e2e-${Date.now()}`
  const created = JSON.parse(
    await runCli(["init", "--label", label, "--allow-create-user"], {}),
  ) as { userId: string; email: string; apiKey: string }
  expect(created.email).toBe(`${label}@localhost`)

  // 2) 持有凭据的一方签发一次性的码
  const issued = JSON.parse(
    await runCli(["issue-pairing-code"], {
      FATEBOOK_AGENT_API_KEY: created.apiKey,
    }),
  ) as { code: string; expiresAt: string; redeemUrl: string }
  expect(issued.code).toMatch(/^[2-9A-HJ-NP-Z]{8}$/)
  expect(issued.redeemUrl.endsWith("/pair")).toBe(true)

  // 3) 在本机浏览器里兑换
  await page.goto("/pair")
  await page.getByLabel("配对码").fill(issued.code)
  await page.getByRole("button", { name: "兑换" }).click()
  await expect(page.getByText(`已作为 ${created.email} 登录`)).toBeVisible()

  // 4) **真正要紧的那一步**：会话能被 NextAuth 读出来。
  //    这才是"这扇门开对了"的判据——页面上的成功文案单独并不能证明它。
  const session = (await (
    await page.request.get("/api/auth/session")
  ).json()) as { user?: { email?: string } }
  expect(session.user?.email).toBe(created.email)

  // 5) 一次有效：同一个码再用一次必须失败（否则它会变成一把长期钥匙）
  await context.clearCookies()
  await page.goto("/pair")
  await page.getByLabel("配对码").fill(issued.code)
  await page.getByRole("button", { name: "兑换" }).click()
  await expect(page.getByText(/无效或已过期/)).toBeVisible()
  const stillOut = (await (
    await page.request.get("/api/auth/session")
  ).json()) as { user?: { email?: string } }
  expect(stillOut.user?.email).toBeUndefined()
})
