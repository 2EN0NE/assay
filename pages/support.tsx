import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

export default function SupportPage() {
  return (
    <div className="prose mx-auto my-8">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {String.raw`
Need help? Open an issue on [GitHub](https://github.com/2EN0NE/assay/issues).

[Back to 试金石](/)
        `}
      </ReactMarkdown>
    </div>
  )
}
