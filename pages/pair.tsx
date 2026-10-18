import type { GetServerSideProps } from "next"
import Link from "next/link"
import { NextSeo } from "next-seo"
import { FormEvent, useState } from "react"
import {
  PAIRING_LOGIN_ENV,
  isPairingLoginEnabled,
} from "../lib/web/pairing_flag"

/**
 * 网页的第二扇门（ADR-0035）：人把一次性配对码填进来，换到一个浏览器会话。
 *
 * 邮件门**不变**——它仍是"人"的门。这一扇给的是已经持有凭据的一方：先
 * `npm run --silent agent -- issue-pairing-code`，再把码填在这里。
 *
 * 关闭时（默认）不画一个注定失败的输入框，而是说清怎么打开它：
 * 这扇门默认关闭是决策本身，不是故障。
 */
/**
 * 开关在**请求时**读（不是构建时）：`.env` 改完重启即生效，不必重新构建。
 * 读取环境变量是同步的，而 `GetServerSideProps` 的签名要求一个 Promise——
 * 因此显式包一层，而不是造一个没有 await 的 `async` 函数（`require-await` 会拦）。
 */
export const getServerSideProps: GetServerSideProps<{
  enabled: boolean
}> = () =>
  Promise.resolve({ props: { enabled: isPairingLoginEnabled(process.env) } })

export default function PairPage({ enabled }: { enabled: boolean }) {
  const [code, setCode] = useState("")
  const [email, setEmail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function redeem(event: FormEvent): Promise<void> {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch("/api/pairing/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      })
      const payload = (await response.json()) as {
        email?: string
        error?: string
      }
      if (!response.ok) {
        setError(payload.error ?? `兑换失败（HTTP ${response.status}）`)
        return
      }
      setEmail(payload.email ?? "")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="px-4 pt-12 lg:pt-16 mx-auto max-w-xl">
      <NextSeo
        title="配对码登录"
        description="用一次性配对码在这台机器上把它换成网页会话"
      />
      <div className="mx-auto prose">
        <h2>配对码登录</h2>
        {!enabled && (
          <>
            <p>
              这扇门默认是<strong>关</strong>的（ADR-0035）。要打开它，在 .env
              里加一行并重启 Web 服务：
            </p>
            <pre>{`${PAIRING_LOGIN_ENV}=1`}</pre>
            <p>
              它刻意不由 NODE_ENV 推断：在内网主机上跑开发模式时，那等于给一台
              服务家人的机器开后门。
            </p>
          </>
        )}
        {enabled && email === null && (
          <>
            <p>先让持有凭据的一方签发一个码（CLI / agent 侧）：</p>
            <pre>npm run --silent agent -- issue-pairing-code</pre>
            <p>码 10 分钟内有效、只能用一次，且只能在这台机器上兑换。</p>
            <form onSubmit={(event) => void redeem(event)}>
              <label className="label font-semibold" htmlFor="pairing-code">
                配对码
              </label>
              <input
                id="pairing-code"
                className="input w-full font-mono tracking-widest uppercase"
                value={code}
                autoComplete="off"
                autoFocus
                onChange={(event) => setCode(event.target.value)}
              />
              {error && <p className="text-error">{error}</p>}
              <button
                type="submit"
                className="button primary mt-4"
                disabled={submitting || code.trim() === ""}
              >
                {submitting ? "兑换中…" : "兑换"}
              </button>
            </form>
          </>
        )}
        {email !== null && (
          <>
            <p>已作为 {email} 登录。这个浏览器现在就是那个身份了。</p>
            <p>
              <Link href="/">进入首页</Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
