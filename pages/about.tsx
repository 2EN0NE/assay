import { NextSeo } from "next-seo"
import Image from "next/image"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { WhyForecastInfo } from "../components/WhyForecastInfo"

const about = String.raw`
试金石 aims to be the fastest way to make and track your predictions.

试金石 是 [Fatebook](https://fatebook.io) 的 fork，上游由 [Sage](https://sage-future.org)（501(c)(3) 慈善机构）制作；本仓库只是个人使用与改造。

Want something changed or added? Open an issue on [GitHub](https://github.com/2EN0NE/assay/issues).

You can use 试金石 through [localhost:3000](https://localhost:3000). 想把它接到别处，到仓库 issue 里说一声即可。

试金石 是开源的：上游代码在 [GitHub](https://github.com/Sage-Future/fatebook)，本仓库（fork）在 [GitHub](https://github.com/2EN0NE/assay)。`

export default function AboutPage() {
  return (
    <div className="px-4 pt-12 lg:pt-16 mx-auto max-w-6xl">
      <NextSeo title="About" />
      <div className="prose mx-auto">
        <h2>About</h2>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{about}</ReactMarkdown>
        <div className="my-4">
          <WhyForecastInfo />
        </div>

        <Image
          src="/telescope_future_1200_white.png"
          width={1200}
          height={686}
          alt=""
        />
      </div>
    </div>
  )
}
