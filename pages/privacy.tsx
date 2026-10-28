import { NextSeo } from "next-seo"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

export default function PrivacyPage() {
  return (
    <div className="prose mx-auto my-8">
      <NextSeo title="Privacy" />
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{privacyMd}</ReactMarkdown>
    </div>
  )
}

const privacyMd = String.raw`
隐私说明
========

本实例（默认 localhost:3000）是**个人自用部署**：没有运营主体，也没有"公司"在收集你的数据。下面只写它**实际**处理的东西。

数据存在哪里
------------

全部在**运行它的那台机器上的 Postgres 里**。没有云端备份，也没有别处的副本——备份与删除都由实例主人负责。

登录
----

只用**邮件魔法链接**：输入邮箱 → 收到一封带登录链接的信 → 点开即登录。因此保存的只有**邮箱地址**与**会话 Cookie**；不收集姓名、头像或第三方社交账号信息。

本地开发时这封信不进真邮箱，而是被 Mailpit 截在 <http://localhost:8025>。

会发出的邮件
------------

登录链接，以及你自己设了结算期限时的提醒邮件。每封信都带退订入口（/unsubscribe），退订状态存在本机数据库。

日志
----

Prisma 的查询日志与 Next.js 的服务日志都写在**本机**，只用于排错。

第三方服务（只有你配置了才会用到）
----------------------------------

| 服务                                 | 何时使用                                  | 出去的是什么         |
| ------------------------------------ | ----------------------------------------- | -------------------- |
| Postmark                             | 配了 POSTMARK_API_TOKEN 时发真实邮件      | 收件人邮箱、邮件正文 |
| 邮件列表（quantifiedintuitions.org） | 配了 MAILING_LIST_SECRET 时               | 注册邮箱、产品与标签 |
| Google Analytics                     | 配了 NEXT_PUBLIC_GA_MEASUREMENT_ID 时     | 使用事件（页面、命令） |

一个都没配就什么都出不去。

你的选择
--------

- **导出**：页面上的 "Export all your forecasts" 随时导出 CSV。
- **退订**：每封邮件里的链接，或 /unsubscribe。
- **删除**：直接删本机数据库里的对应记录（或整个库）。没有别人保管你的副本，也没有别人需要批准。

变更
----

这份说明随仓库一起变更，历史版本见 git 记录。

有问题到仓库开 issue：<https://github.com/2EN0NE/assay/issues>
`
