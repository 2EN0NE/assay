import { Question } from "@prisma/client"
import { GetServerSideProps } from "next"
import { NextSeo } from "next-seo"
import { QuestionOrSignIn } from "../../components/questions/QuestionOrSignIn"
import prisma from "../../lib/prisma"
import { extractQuestionId } from "../../lib/web/question_url"

export const getServerSideProps: GetServerSideProps<{
  question: Question | null
}> = async (context) => {
  const questionId =
    typeof context.params?.id === "string"
      ? extractQuestionId(context.params.id)
      : undefined
  const question = await prisma.question.findUnique({
    where: { id: questionId || "NO MATCH" },
  })

  // only pass if shared publicly and not unlisted, to set robots to index
  if (question && question.sharedPublicly && !question.unlisted) {
    return {
      props: { question: JSON.parse(JSON.stringify(question)) },
    }
  }

  return {
    props: { question: null },
  }
}

export default function QuestionPage({
  question,
}: {
  question: Question | undefined
}) {
  const shouldIndex = question && question.sharedPublicly && !question.unlisted

  return (
    <div className="px-4 pt-12 lg:pt-16 mx-auto max-w-6xl">
      <NextSeo noindex={!shouldIndex} nofollow={!shouldIndex} />
      <div className="prose mx-auto">
        <QuestionOrSignIn alwaysExpand={true} embedded={false} />
      </div>
    </div>
  )
}
