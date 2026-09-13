import { Question, QuestionType, Resolution } from "@prisma/client"
import {
  QuestionOptionWithForecastsAndScores,
  QuestionWithForecastsAndOptionsAndScores,
  QuestionWithForecastsAndScores,
  QuestionWithScores,
} from "../../prisma/additional"
import { log, warn } from "../_log"
import {
  dropRelativeScores,
  ScoreCollection,
  ScoreTuple,
  relativeBrierScoring,
} from "../_scoring"
import { filterToUniqueIds } from "../_utils_common"
import prisma from "../prisma"
import { endorsedForecasts, isRelativeScored } from "./calibration"
import { createNotification } from "./notifications"
import { getQuestionUrl } from "./question_url"

/** 结算证据（ADR-0004）：自行结算与提案被采纳时随结算一并写入。 */
export type ResolutionEvidence = {
  source?: string | null
  rationale?: string | null
}

async function dbResolveQuestion(
  questionid: string,
  resolution: Resolution,
  evidence?: ResolutionEvidence,
) {
  log(`      dbResolveQuestion ${questionid} - ${resolution}`)
  return await prisma.question.update({
    where: {
      id: questionid,
    },
    data: {
      resolved: true,
      resolution: resolution,
      resolvedAt: new Date(),
      ...(evidence
        ? {
            resolutionSource: evidence.source ?? null,
            resolutionRationale: evidence.rationale ?? null,
          }
        : {}),
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
  log(`dbresolveNonExclusiveQuestionOption ${questionId} - ${resolution}`)
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
  log(`dbResolveQuestionOption ${questionId} - ${resolution}`)

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
  log(`updating questionScores for option id: ${option.id}`)

  if (option.questionScores) {
    warn(
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
    log(`  user id: ${id} with relative score ${relativeScore}`)
  }
  await prisma.$transaction(updateArray)
}

export async function scoreForecasts(
  scoreArray: ScoreCollection,
  question: QuestionWithScores,
) {
  log(`updating questionScores for question id: ${question.id}`)

  if (question.questionScores) {
    warn(
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
    log(`  user id: ${id} with relative score ${relativeScore}`)
  }
  await prisma.$transaction(updateArray)
}

export async function handleQuestionResolution(
  questionId: string,
  resolution: string,
  questionType: QuestionType,
  optionId?: string,
  evidence?: ResolutionEvidence,
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

  log(`    handleQuestionResolution: ${questionId} ${resolution}`)
  let resolutionValue: Resolution

  if (Object.values(Resolution).includes(resolution as Resolution)) {
    resolutionValue = resolution as Resolution
  } else {
    resolutionValue = Resolution.YES
  }

  log(`resolutionValue: ${resolutionValue}`)

  const question = await dbResolveQuestion(
    questionId,
    resolutionValue,
    evidence,
  )
  log(`    handledUpdateQuestionResolution: ${questionId} ${resolution}`)

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
  // ADR-0018：判据判不出来（AMBIGUOUS）→ 没有样本可计，不产生任何分数、也不落库。
  // 旧实现在这里给每个预测者造一条全零占位，而 `relativeScore = 0` 是 Brier 的
  // 「满分」语义——一旦有人落库它，判不出来的题会把所有人排到第一。
  if (resolution != Resolution.AMBIGUOUS) {
    log("Question is unambig")
    // ADR-0008：未背书的 agent 搜集样本不计入校准
    scores = relativeBrierScoring(
      endorsedForecasts(question.forecasts),
      question,
    )
    // ADR-0002：非公共事实类不进入相对分（写库即为 relativeScore = null）
    if (!isRelativeScored(question.oracleKind)) {
      scores = dropRelativeScores(scores)
    }
    await scoreForecasts(scores, question)
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
    log("Question is unambiguous")

    const userScores: {
      [userId: string]: ScoreTuple & { count: number }
    } = {}

    for (const option of question.options) {
      const optionScores = relativeBrierScoring(
        endorsedForecasts(option.forecasts),
        option,
      )
      // ADR-0002：非公共事实类的选项级分数也不带相对分
      const tempScores = isRelativeScored(question.oracleKind)
        ? optionScores
        : dropRelativeScores(optionScores)
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
        // ADR-0002：null 表示「不参与相对分」——跳过它，而不是把 null 当 0 加进来
        if (score.relativeBrierScore !== null) {
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
        if (score.relativeBrierScore !== null) {
          score.relativeBrierScore /= score.count
        }
      }
      // eslint-disable-next-line no-unused-vars
      const { count, ...finalScore } = score
      scores[userId] = finalScore
    }

    if (isRelativeScored(question.oracleKind)) {
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
      // 非公共事实类：没有相对分可排，改按绝对分排
      scores = dropRelativeScores(scores)
    }
  }

  return scores
}

/**
 * 重算一条**已结算**问题的分数（不重新结算、不改 `resolvedAt`）。
 *
 * 存在理由：背书可以发生在结算之后。若不重算，ADR-0008 承诺的「背书后才进校准」
 * 会在这一路径上静默落空——界面上提示消失，分数却永远不补。
 */
export async function rescoreResolvedQuestion(
  questionId: string,
): Promise<void> {
  const question = await prisma.question.findUnique({
    where: { id: questionId },
    include: {
      forecasts: true,
      questionScores: true,
      options: {
        include: { forecasts: true, questionScores: true },
      },
    },
  })
  if (!question?.resolved || !question.resolution) return

  if (question.type === QuestionType.BINARY) {
    await scoreQuestion(question.resolution, question)
    return
  }

  await scoreQuestionOptions(
    question.resolution,
    question,
    question.exclusiveAnswers ?? true,
  )
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
