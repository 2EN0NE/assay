import crypto from "node:crypto"

/**
 * 一次性配对码的纯规则（ADR-0035）：形状、时效、兑换资格与失败限流。
 *
 * 刻意不 import prisma / next；**但本文件有 `node:crypto`，所以浏览器侧不得导入它**
 * （`pages/pair.tsx` 只能用 `pairing_flag.ts`——webpack 的客户端打包解析不了 `node:`
 * 协议，实测会让整页变成 Build Error）。落库的部分在 `pairing_code_store.ts`。
 */

/** 短时效（ADR-0035）。改大它等于放宽那扇门，所以测试直接钉住这个数。 */
export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000

export const PAIRING_CODE_LENGTH = 8

/**
 * 去掉 0/O、1/I/L —— 这个码是给人手抄或口述的，形近字符的代价是一次
 * 失败尝试，而失败尝试会消耗限流额度。
 */
const PAIRING_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"

/** 用 `crypto.randomInt` 而不是 `Math.random`：这是凭据，不是 id。 */
export function generatePairingCode(): string {
  let code = ""
  for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
    code +=
      PAIRING_CODE_ALPHABET[crypto.randomInt(PAIRING_CODE_ALPHABET.length)]
  }
  return code
}

/**
 * 归一化：大小写、空格、连字符都不影响"是同一个码"。
 * 人抄写时多打一个空格不该被当成攻击，也不该逼他重跑一条 CLI 命令。
 */
export function normalizePairingCode(raw: string): string {
  return raw.toUpperCase().replace(/[^0-9A-Z]/g, "")
}

/** 库里只存哈希：库泄漏时读不出一把还能用的钥匙（明文只在签发那一刻出现）。 */
export function hashPairingCode(code: string): string {
  return crypto
    .createHash("sha256")
    .update(normalizePairingCode(code))
    .digest("hex")
}

function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false
  const value = address.trim().toLowerCase()
  if (value === "::1") return true
  // Node 在双栈监听下把 IPv4 回环报成 IPv4-mapped IPv6
  if (value === "::ffff:127.0.0.1") return true
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)
}

/** `[::1]:3000` / `localhost:3000` / `localhost` → 主机名（小写）。 */
function hostnameOfHostHeader(hostHeader: string | undefined): string {
  if (!hostHeader) return ""
  const value = hostHeader.trim().toLowerCase()
  if (value.startsWith("[")) {
    const end = value.indexOf("]")
    return end === -1 ? "" : value.slice(1, end)
  }
  const colon = value.lastIndexOf(":")
  return colon === -1 ? value : value.slice(0, colon)
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || isLoopbackAddress(hostname)
}

/** 请求里我们实际要看的那两格（便于用合成数据验证，不必造真的 IncomingMessage）。 */
export type LocalRequestLike = {
  socket?: { remoteAddress?: string } | null
  headers?: { host?: string | string[] } | undefined
}

/**
 * 这台机器的浏览器吗（ADR-0035：只在实例本机可兑换）。
 *
 * 两个条件都要：连接来自回环地址，**且**浏览器访问的主机名也是回环。
 * 只看前者时，任何反向代理（`local-ssl-proxy`、nginx）都会让远端来客
 * 以 `127.0.0.1` 出现——那扇门就对整个内网开着，而且**不会有任何症状**。
 * 判不出来（缺 Host、缺 socket）时不开门。
 */
export function isLocalRequest(req: LocalRequestLike): boolean {
  const host = req.headers?.host
  const hostname = hostnameOfHostHeader(Array.isArray(host) ? host[0] : host)
  return (
    isLoopbackAddress(req.socket?.remoteAddress) && isLoopbackHostname(hostname)
  )
}

export type FailureLimiter = {
  isBlocked: (key: string, now: Date) => boolean
  recordFailure: (key: string, now: Date) => void
}

/**
 * 失败限流（ADR-0035）：窗口从**第一次失败**起算，窗口内累计到上限即封锁。
 *
 * 只记内存、只按来源分（本机场景下就是回环地址），所以它挡的是"脚本猛试"，
 * 不是"有人重启了服务再来"——后者的代价由 10 分钟时效与一次性承担。
 */
export function createFailureLimiter(
  limit: number,
  windowMs: number,
): FailureLimiter {
  const failures = new Map<string, { count: number; firstFailedAtMs: number }>()

  const live = (key: string, now: Date) => {
    const entry = failures.get(key)
    if (!entry) return undefined
    if (now.getTime() - entry.firstFailedAtMs >= windowMs) {
      failures.delete(key)
      return undefined
    }
    return entry
  }

  return {
    isBlocked: (key, now) => {
      const entry = live(key, now)
      return entry !== undefined && entry.count >= limit
    },
    recordFailure: (key, now) => {
      const entry = live(key, now)
      if (!entry) {
        failures.set(key, { count: 1, firstFailedAtMs: now.getTime() })
        return
      }
      entry.count += 1
    },
  }
}
