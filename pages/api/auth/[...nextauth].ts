import { PrismaAdapter } from "@next-auth/prisma-adapter"
import { NextApiRequest, NextApiResponse } from "next"
import NextAuth, { NextAuthOptions, Session, User } from "next-auth"
import { JWT } from "next-auth/jwt"
import EmailProvider from "next-auth/providers/email"
import {
  capitalizeFirstLetter,
  subscribeToMailingList,
} from "../../../lib/_utils_common"
import { backendAnalyticsEvent } from "../../../lib/_utils_server"
import prisma from "../../../lib/prisma"
import { log } from "../../../lib/_log"
import {
  secureCookiesEnabled,
  sessionCookiePrefix,
  sessionCookieSameSite,
  sessionTokenCookie,
} from "../../../lib/web/session_cookie"
import { subscribeToMailingListSafely } from "../../../lib/web/mailing_list"

function getCookies() {
  /* Copied from:
    https://github.com/nextauthjs/next-auth/blob/c0f9af4c567a905c9d55b732cc0610d44fbae5a6/packages/core/src/lib/cookie.ts#L53
    https://github.com/nextauthjs/next-auth/blob/c0f9af4c567a905c9d55b732cc0610d44fbae5a6/packages/next-auth/src/core/init.ts#L77
  */

  // 判据也只有一处：cookie 名与选项都由它派生，写两遍就会分家而没有症状。
  const useSecureCookies = secureCookiesEnabled()
  const cookiePrefix = sessionCookiePrefix(useSecureCookies)
  const sameSite = sessionCookieSameSite(useSecureCookies)

  return {
    // 会话 cookie 的名字与选项只有一处定义：配对码兑换（ADR-0035）必须写入
    // **同一个** cookie，否则"登录成功"与"NextAuth 认得出你"会分家而没有症状。
    sessionToken: sessionTokenCookie(useSecureCookies),
    callbackUrl: {
      name: `${cookiePrefix}next-auth.callback-url`,
      options: {
        httpOnly: true,
        sameSite,
        path: "/",
        secure: useSecureCookies,
      },
    },
    csrfToken: {
      // Default to __Host- for CSRF token for additional protection if using useSecureCookies
      // NB: The `__Host-` prefix is stricter than the `__Secure-` prefix.
      name: `${useSecureCookies ? "__Host-" : ""}next-auth.csrf-token`,
      options: {
        httpOnly: true,
        sameSite,
        path: "/",
        secure: useSecureCookies,
      },
    },
    pkceCodeVerifier: {
      name: `${cookiePrefix}next-auth.pkce.code_verifier`,
      options: {
        httpOnly: true,
        sameSite,
        path: "/",
        secure: useSecureCookies,
        maxAge: 60 * 15, // 15 minutes in seconds
      },
    },
    state: {
      name: `${cookiePrefix}next-auth.state`,
      options: {
        httpOnly: true,
        sameSite,
        path: "/",
        secure: useSecureCookies,
        maxAge: 60 * 15, // 15 minutes in seconds
      },
    },
    nonce: {
      name: `${cookiePrefix}next-auth.nonce`,
      options: {
        httpOnly: true,
        sameSite,
        path: "/",
        secure: useSecureCookies,
      },
    },
  }
}

export const authOptions: NextAuthOptions = {
  adapter: {
    ...PrismaAdapter(prisma),
    createUser: async (user: {
      email: string
      name?: string | null
      emailVerified: Date | null
    }) => {
      const createdUser = await PrismaAdapter(prisma).createUser!({
        ...user,
        // if the user has no name (e.g. if signed up using Email provider), use the email as the name
        // capitalize and replace dots with spaces to make it more name-y
        name:
          user.name ||
          (user.email
            ? capitalizeFirstLetter(user.email?.split("@")[0]).replaceAll(
                ".",
                " ",
              )
            : undefined),
      })

      if (createdUser.email) {
        log("Subscribing to mailing list", createdUser.email)
        // 订阅是**营销副作用**：它失败绝不能影响注册本身。
        // 早先这里是裸的 `void subscribeToMailingList(...)`——一旦拒绝就成为
        // unhandledRejection，而 Next dev 会为它弹出全屏错误层，把整个页面盖住
        // （e2e 因此全线失败）。兜底逻辑抽在 `subscribeToMailingListSafely` 里，
        // 好让"失败也不影响注册"这条性质真的被测试锁住。
        void subscribeToMailingListSafely(
          subscribeToMailingList,
          createdUser.email,
          createdUser.name || undefined,
        )
      }

      return createdUser
    },
    async useVerificationToken(identifier_token) {
      try {
        // this is a workaround for Outlook SafeLink which pre-fetches links in emails and is hard to detect
        // the rest of this function is copied from PrismaAdapter
        const verificationToken = await prisma.verificationToken.findUnique({
          where: { identifier_token },
        })
        return verificationToken
      } catch (error: any) {
        // If token already used/deleted, just return null
        // https://www.prisma.io/docs/reference/api-reference/error-reference#p2025
        if (error.code === "P2025") return null
        throw error
      }
    },
  },
  providers: [
    EmailProvider({
      server: process.env.AUTH_EMAIL_SERVER,
      from: process.env.AUTH_EMAIL_FROM,
      maxAge: 20 * 60, // 20 minutes in seconds. Reduced because of Outlook SafeLink workaround
    }),
  ],
  theme: {
    colorScheme: "light",
    brandColor: "#4338ca",
  },
  secret: process.env.SECRET,
  session: {
    strategy: "jwt",
  },
  jwt: {
    secret: process.env.SECRET,
  },
  useSecureCookies: secureCookiesEnabled(),

  cookies: getCookies(),

  events: {
    createUser: async () => {
      await backendAnalyticsEvent("new_user", {
        platform: "web",
      })
    },
    linkAccount: async ({ user, profile }) => {
      // if the user has no name or image, update it from the profile
      // useful for when a user is created by having a question shared with them
      if (!user.name && profile.name) {
        await prisma.user.update({
          where: {
            id: user.id,
          },
          data: {
            name: profile.name,
          },
        })
      }

      if (!user.image && profile.image) {
        await prisma.user.update({
          where: {
            id: user.id,
          },
          data: {
            image: profile.image,
          },
        })
      }
    },
  },
  callbacks: {
    session: (params: { session: Session; token: JWT }) => {
      const { session, token } = params
      if (token.id && session.user) {
        session.user.id = token.id as string
      }
      return Promise.resolve(session)
    },
    jwt: (params: {
      token: JWT
      user?: User | undefined
      trigger?: "update" | "signIn" | "signUp"
      session?: Session
    }) => {
      const { token, user, trigger, session } = params
      if (user) {
        token.id = user.id
      }
      if (trigger === "update" && session?.user?.name) {
        token.name = session.user.name
      }
      return Promise.resolve(token)
    },
  },
}

const nextAuthHandler = NextAuth(authOptions)

export default async function auth(req: NextApiRequest, res: NextApiResponse) {
  // handle HEAD requests from Outlook SafeLink
  // https://next-auth.js.org/tutorials/avoid-corporate-link-checking-email-provider
  if (req.method === "HEAD") {
    log("HEAD request, returning 200")
    return res.status(200).end()
  }

  await nextAuthHandler(req, res)
}
