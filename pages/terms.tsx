import { NextSeo } from "next-seo"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

export default function TermsPage() {
  return (
    <div className="prose mx-auto my-8">
      <NextSeo title="Privacy" />
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{termsMd}</ReactMarkdown>
    </div>
  )
}

const termsMd = String.raw`
试金石 使用说明
================

**本实例是个人自用部署**：默认跑在 localhost:3000，不对外提供服务，没有运营主体，也没有客服。因此这里不是一份"服务条款"——没有服务承诺、没有 SLA、没有争议解决与仲裁条款。

这是什么
--------

代码是 [Fatebook](https://fatebook.io) 的 fork，以 MIT 许可分发（见仓库 LICENSE，上游版权归原作者）。本仓库的改造见 [GitHub](https://github.com/2EN0NE/assay)。

按原样提供
----------

不提供任何明示或默示的担保；不保证可用、不保证准确，也不保证数据不丢。数据就在运行它的那台机器上，**备份是实例主人的责任**。

你能做什么
----------

自由使用、修改、自建实例。但不要把改动后的实例说成上游或他人的服务。

你的数据
--------

你写的决策、预测与复盘记录都属于你。数据怎么处理见 [隐私说明](/privacy)，随时可以在页面上导出全部数据。

有问题到仓库开 issue：<https://github.com/2EN0NE/assay/issues>
`
