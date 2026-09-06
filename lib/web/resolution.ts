import { Question, QuestionType, Resolution } from "@prisma/client"
import {
  QuestionOptionWithForecastsAndScores,
  QuestionWithForecastsAndOptionsAndScores,
  QuestionWithForecastsAndScores,
  QuestionWithScores,
} from "../../prisma/additional"
import { ScoreCollection, ScoreTuple, relativeBrierScoring } from "../_scoring"
import { filterToUniqueIds } from "../_utils_common"
import prisma from "../prisma"
import { createNotification } from "./notifications"
import { getQuestionUrl } from "./question_url"

async function dbResolveQuestion(questionid: string, resolution: Resolution) {
  console.log(`      dbResolveQuestion ${questionid} - ${resolution}`)
  return await prisma.question.update({
    where: {
      id: questionid,
    },
    data: {
      resolved: true,
      resolution: resolution,
      resolvedAt: new Date(),
    },
    include: {
      user: true,
      forecasts: {
        include: {
          user: true,
        },
      },
      options: {
        include: {
          forecasts: true,
        },
      },
      comments: {
        include: {
          user: true,
        },
      },
      sharedWith: true,
      sharedWithLists: {
        include: {
          users: true,
        },
      },
      questionScores: true,
    },
  })
}

async function dbResolveNonExclusiveQuestionOption(
  questionId: string,
  resolution: Resolution,
  optionId: string,
) {
  console.log(
    `dbresolveNonExclusiveQuestionOption ${questionId} - ${resolution}`,
  )
  await prisma.questionOption.update({
    where: {
      id: optionId,
    },
    data: {
      resolution: resolution,
      resolvedAt: new Date(),
    },
  })

  return prisma.question.update({
    where: {
      id: questionId,
    },
    data: {},
    include: {
      user: true,
      forecasts: {
        include: {
          user: true,
        },
      },
      options: {
        include: {
          forecasts: true,
          questionScores: true,
        },
      },
      comments: {
        include: {
          user: true,
        },
      },
      sharedWith: true,
      sharedWithLists: {
        include: {
          users: true,
        },
      },
      questionScores: true,
    },
  })
}

async function dbResolveExclusiveQuestionOption(
  questionId: string,
  resolution: string,
) {
  console.log(`dbResolveQuestionOption ${questionId} - ${resolution}`)

  const question = await prisma.question.findUnique({
    where: {
      id: questionId,
    },
    include: {
      options: true,
    },
  })

  if (!question) {
    throw new Error(`Question with id ${questionId} not found`)
  }

  const updatedOptions = question.options.map((option) => {
    return {
      where: { id: option.id },
      data: {
        resolution: option.text === resolution ? Resolution.YES : Resolution.NO,
        resolvedAt: new Date(),
      },
    }
  })

  for (const update of updatedOptions) {
    await prisma.questionOption.update(update)
  }

  let resolutionValue: Resolution
  if (Object.values(Resolution).includes(resolution as Resolution)) {
    resolutionValue = resolution as Resolution
  } else {
    resolutionValue = resolution === "OTHER" ? Resolution.NO : Resolution.YES
  }

  return prisma.question.update({
    where: {
      id: questionId,
    },
    data: {
      resolved: true,
      resolution: resolutionValue,
      resolvedAt: new Date(),
    },
    include: {
      user: true,
      forecasts: {
        include: {
          user: true,
        },
      },
      options: {
        include: {
          forecasts: true,
          questionScores: true,
        },
      },
      comments: {
        include: {
          user: true,
        },
      },
      sharedWith: true,
      sharedWithLists: {
        include: {
          users: true,
        },
      },
      questionScores: true,
    },
  })
}

export async function scoreOptionForecasts(
  scoreArray: ScoreCollection,
  question: Question,
  option: QuestionOptionWithForecastsAndScores,
) {
  console.log(`updating questionScores for option id: ${option.id}`)

  if (option.questionScores) {
    console.warn(
      "Warning: questionScores already existed for question being resolved. Deleting all previous questionScores.",
      { dscores: option.questionScores },
    )
    await prisma.questionScore.deleteMany({
      where: {
        questionOptionId: option.id,
      },
    })
  }

  let updateArray: any[] = []
  for (const id in scoreArray) {
    const relativeScore = scoreArray[id].relativeBrierScore
    const absoluteScore = scoreArray[id].absoluteBrierScore
    const rank = scoreArray[id].rank
    let userQuestionComboId = `${id}-${option.id}`
    updateArray.push(
      prisma.questionScore.upsert({
        where: {
          userQuestionComboId: userQuestionComboId,
        },
        update: {
          relativeScore: relativeScore,
          absoluteScore: absoluteScore,
          rank: rank,
        },
        create: {
          userQuestionComboId: userQuestionComboId,
          userId: id,
          questionId: question.id,
          questionOptionId: option.id,
          relativeScore: relativeScore,
          absoluteScore: absoluteScore,
          rank: rank,
        },
      }),
    )
    console.log(`  user id: ${id} with relative score ${relativeScore}`)
  }
  await prisma.$transaction(updateArray)
}

export async function scoreForecasts(
  scoreArray: ScoreCollection,
  question: QuestionWithScores,
) {
  console.log(`updating questionScores for question id: ${question.id}`)

  if (question.questionScores) {
    console.warn(
      "Warning: questionScores already existed for question being resolved. Deleting all previous questionScores.",
      { dscores: question.questionScores },
    )
    await prisma.questionScore.deleteMany({
      where: {
        questionId: question.id,
      },
    })
  }

  let updateArray: any[] = []
  for (const id in scoreArray) {
    const relativeScore = scoreArray[id].relativeBrierScore
    const absoluteScore = scoreArray[id].absoluteBrierScore
    const rank = scoreArray[id].rank
    let userQuestionComboId = `${id}-${question.id}`
    updateArray.push(
      prisma.questionScore.upsert({
        where: {
          userQuestionComboId: userQuestionComboId,
        },
        update: {
          relativeScore: relativeScore,
          absoluteScore: absoluteScore,
          rank: rank,
        },
        create: {
          userQuestionComboId: userQuestionComboId,
          userId: id,
          questionId: question.id,
          relativeScore: relativeScore,
          absoluteScore: absoluteScore,
          rank: rank,
        },
      }),
    )
    console.log(`  user id: ${id} with relative score ${relativeScore}`)
  }
  await prisma.$transaction(updateArray)
}

export async function handleQuestionResolution(
  questionId: string,
  resolution: string,
  questionType: QuestionType,
  optionId?: string,
) {
  if (optionId) {
    const result = await dbResolveNonExclusiveQuestionOption(
      questionId,
      resolution as Resolution,
      optionId,
    )

    const questionOptions = await prisma.questionOption.findMany({
      where: {
        questionId: questionId,
      },
    })
    const unresolvedOptions = questionOptions.filter(
      (option) => option.resolution === null,
    )
    if (unresolvedOptions.length === 0) {
      await scoreQuestionOptions(resolution, result, false)
    } else {
      return
    }
  }

  console.log(`    handleQuestionResolution: ${questionId} ${resolution}`)
  let resolutionValue: Resolution

  if (Object.values(Resolution).includes(resolution as Resolution)) {
    resolutionValue = resolution as Resolution
  } else {
    resolutionValue = Resolution.YES
  }

  console.log(`resolutionValue: ${resolutionValue}`)

  const question = await dbResolveQuestion(questionId, resolutionValue)
  console.log(
    `    handledUpdateQuestionResolution: ${questionId} ${resolution}`,
  )

  if (!optionId) {
    if (questionType === QuestionType.BINARY) {
      await scoreQuestion(resolution as Resolution, question)
    } else {
      const result = await dbResolveExclusiveQuestionOption(
        questionId,
        resolution,
      )
      await scoreQuestionOptions(resolution, result, true)
    }
  }

  const q = question
  for (const user of filterToUniqueIds([
    q.user,
    ...q.forecasts.map((f) => f.user),
    ...q.comments.map((c) => c.user),
    ...q.sharedWith,
    ...q.sharedWithLists.flatMap((l) => l.users),
  ]).filter((u) => u && u.id !== q.userId)) {
    await createNotification({
      userId: user.id,
      title: `${q.user.name || "Someone"} resolved ${q.resolution}: "${
        q.title
      }"`,
      content: `${q.user.name || "Someone"} resolved ${
        q.type === "MULTIPLE_CHOICE" ? "" : `as ${q.resolution} `
      }`,
      tags: ["question_resolved", q.id],
      url: getQuestionUrl(q),
      questionId: q.id,
    })
  }
}

export async function scoreQuestion(
  resolution: Resolution,
  question: QuestionWithForecastsAndScores,
) {
  let scores: ScoreCollection = {}
  if (resolution != Resolution.AMBIGUOUS) {
    console.log("Question is unambig")
    scores = relativeBrierScoring(question.forecasts, question)
    await scoreForecasts(scores, question)
  } else {
    let uniqueIds = Array.from(new Set(question.forecasts.map((f) => f.userId)))
    scores = uniqueIds
      .map((id) => {
        return {
          [id]: {
            absoluteBrierScore: 0,
            relativeBrierScore: 0,
            rank: 0,
          } as ScoreTuple,
        }
      })
      .reduce((a, b) => Object.assign(a, b), {})
  }
  return scores
}

export async function scoreQuestionOptions(
  resolution: string,
  question: QuestionWithForecastsAndOptionsAndScores,
  exclusive: boolean,
): Promise<ScoreCollection> {
  let scores: ScoreCollection = {}

  if (resolution !== Resolution.AMBIGUOUS) {
    console.log("Question is unambiguous")

    const userScores: {
      [userId: string]: ScoreTuple & { count: number }
    } = {}

    for (const option of question.options) {
      const tempScores = relativeBrierScoring(option.forecasts, option)
      await scoreOptionForecasts(tempScores, question, option)

      for (const [userId, score] of Object.entries(tempScores)) {
        if (!userScores[userId]) {
          userScores[userId] = {
            absoluteBrierScore: 0,
            relativeBrierScore: 0,
            rank: 0,
            count: 0,
          }
        }
        userScores[userId].absoluteBrierScore += score.absoluteBrierScore
        if (score.relativeBrierScore !== undefined) {
          userScores[userId].relativeBrierScore =
            (userScores[userId].relativeBrierScore || 0) +
            score.relativeBrierScore
        }
        userScores[userId].count++
      }
    }

    for (const [userId, score] of Object.entries(userScores)) {
      if (!exclusive) {
        score.absoluteBrierScore /= score.count
        if (score.relativeBrierScore !== undefined) {
          score.relativeBrierScore /= score.count
        }
      }
      // eslint-disable-next-line no-unused-vars
      const { count, ...finalScore } = score
      scores[userId] = finalScore
    }

    const sortedUsers = Object.entries(scores).sort(
      ([, a], [, b]) =>
        (a.relativeBrierScore || 0) - (b.relativeBrierScore || 0),
    )

    sortedUsers.forEach(([userId, score], index) => {
      scores[userId] = {
        ...score,
        rank: index + 1,
      }
    })
  } else {
    let uniqueIds = Array.from(new Set(question.forecasts.map((f) => f.userId)))
    scores = Object.fromEntries(
      uniqueIds.map((id) => [
        id,
        {
          absoluteBrierScore: 0,
          relativeBrierScore: 0,
          rank: 0,
        } as ScoreTuple,
      ]),
    )
  }

  return scores
}

export async function undoQuestionOptionResolution(optionId: string) {
  await prisma.$transaction([
    prisma.questionOption.update({
      where: {
        id: optionId,
      },
      data: {
        resolution: null,
        resolvedAt: null,
      },
    }),
    prisma.questionScore.deleteMany({
      where: {
        questionOptionId: optionId,
      },
    }),
  ])
}

export async function undoQuestionResolution(questionId: string) {
  await prisma.$transaction(async (tx) => {
    const questionMidUpdate = await tx.question.update({
      where: {
        id: questionId,
      },
      data: {
        resolution: null,
        resolvedAt: null,
        resolved: false,
      },
    })

    if (questionMidUpdate.exclusiveAnswers) {
      await tx.questionOption.updateMany({
        where: {
          questionId: questionId,
        },
        data: {
          resolution: null,
          resolvedAt: null,
        },
      })
    }

    await tx.questionScore.deleteMany({
      where: {
        questionId: questionId,
      },
    })
  })
}

export async function deleteQuestion(questionId: string) {
  await prisma.question.delete({
    where: {
      id: questionId,
    },
  })
}
