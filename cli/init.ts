import prisma from "../lib/prisma"
import { generateApiKey } from "../lib/api_key"
import { CliError } from "./args"

/**
 * 在库里创建一个身份并打印它的凭据（ADR-0022）。
 *
 * 这是"开箱即用的第一道墙"的拆除：在此之前，创建一个账号的唯一途径是
 * 走邮件登录，而 Agent 需要一个不需要浏览器也不需要邮件通道的起点。
 */
export type InitResult = {
  userId: string
  email: string
  apiKey: string
}

export async function initOwner(input: {
  label: string
  allowCreateUser: boolean
}): Promise<InitResult> {
  const existing = await prisma.user.count()
  if (existing > 0 && !input.allowCreateUser) {
    throw new CliError(
      `库里已有 ${existing} 个身份，拒绝自动建号`,
      "确认要再建一个就加 --allow-create-user。这条护栏是有意的（ADR-0022）：能建号等于能自助注册。",
    )
  }

  // 身份可以没有真实邮箱（ADR-0022），但 User.email 仍是必填唯一字段，
  // 所以用一个不会被误当成真实收件地址的占位标识。
  const email = `${input.label}@localhost`
  const clash = await prisma.user.findUnique({ where: { email } })
  if (clash) {
    throw new CliError(
      `身份 ${email} 已存在`,
      "换个 --label，或用 Web 的 /api-setup 轮换它的钥匙。",
    )
  }

  const apiKey = generateApiKey()
  const user = await prisma.user.create({ data: { email, apiKey } })

  return { userId: user.id, email, apiKey }
}
