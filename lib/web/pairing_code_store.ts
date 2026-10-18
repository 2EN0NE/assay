import prisma from "../prisma"
import {
  PAIRING_CODE_TTL_MS,
  generatePairingCode,
  hashPairingCode,
} from "./pairing_code"

/**
 * 配对码的落库部分（ADR-0035）。纯规则在 `pairing_code.ts`，这里只管两件事：
 * 签发，以及**以一次为限**地领取。
 */

export type IssuedPairingCode = { code: string; expiresAt: Date }

export async function issuePairingCode(
  userId: string,
  now: Date = new Date(),
): Promise<IssuedPairingCode> {
  const code = generatePairingCode()
  const expiresAt = new Date(now.getTime() + PAIRING_CODE_TTL_MS)

  // 顺手清掉这个身份自己**已过期**的码。不限 `usedAt`：用过的行同样过期即无用，
  // 只删未用的那批会让"每次签发都留一条永久记录"，表就一直长。未过期的行一条不碰
  // （用过的在过期前留着无害，也看得出最近签发过）。`userId` 限定是自己这一份——
  // 别人的码不该被我的一次签发带走。
  await prisma.pairingCode.deleteMany({
    where: { userId, expiresAt: { lte: now } },
  })
  await prisma.pairingCode.create({
    data: { codeHash: hashPairingCode(code), userId, expiresAt },
  })

  return { code, expiresAt }
}

/**
 * 领用一个码；成功则返回它属于谁，失败返回 `null`（调用方只需"通/不通"）。
 *
 * 一次有效靠**带条件的更新**保证，而不是"先查再改"：两个并发请求里只可能有一个
 * 把 `usedAt` 从 NULL 改成时间，另一个拿到 `count = 0` ⇒ 拿不到身份。先查再改
 * 会让同一个码被用两次，而那种事不会有任何症状。
 */
export async function redeemPairingCode(
  rawCode: string,
  now: Date = new Date(),
): Promise<string | null> {
  const codeHash = hashPairingCode(rawCode)

  const claimed = await prisma.pairingCode.updateMany({
    where: { codeHash, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  })
  if (claimed.count !== 1) return null

  const row = await prisma.pairingCode.findUnique({
    where: { codeHash },
    select: { userId: true },
  })
  return row?.userId ?? null
}
