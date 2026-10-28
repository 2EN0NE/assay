import { NextSeo } from "next-seo"
import Link from "next/link"
import { repoIssuesUrl } from "../lib/_constants"
export default function Custom500() {
  return (
    <div className="px-4 pt-12 lg:pt-16 mx-auto max-w-6xl">
      <NextSeo title="Error: 500" />
      <div className="prose mx-auto">
        <h4>
          Sorry, looks like an error on our end. Try again,{" "}
          <Link href={repoIssuesUrl} target="_blank">
            open an issue
          </Link>
          , or <Link href="/">go home</Link>.
        </h4>
      </div>
    </div>
  )
}
