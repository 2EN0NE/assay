import { Forecast, QuestionType, Resolution } from "@prisma/client"
import type { NextApiRequest, NextApiResponse } from "next"
import ChartJSImage from "chart.js-image"
import prisma from "../../lib/prisma"
import { ENDORSED_ONLY } from "../../lib/web/calibration"
import { calibrationBinsOf } from "../../lib/web/calibration_bins"
import { countsTowardMetrics } from "../../lib/web/settlement_scope"
import { getChartJsParams } from "../../lib/web/utils"
import { log } from "../../lib/_log"

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<void> {
  if (!req.query.user) {
    res.send("Missing user in query")
  }

  const userId = req.query.user as string

  const results = await getBucketedForecasts(userId)
  if (!results) {
    res.send("No results")
    return
  }
  const { bucketedForecasts } = results

  const chartJs = new ChartJSImage()
  const lineChart = chartJs
    //@ts-ignore - the library's type definition is incorrect
    .chart(getChartJsParams(bucketedForecasts))
    .backgroundColor("#111")
    .width("550")
    .height("500")

  log("Generated image")

  // send the image
  res.setHeader("Content-Type", "image/png")
  res.send(await lineChart.toBuffer())
}

export async function getBucketedForecasts(userId: string, tags?: string[]) {
  const questions = await prisma.question.findMany({
    where: {
      AND: [
        {
          OR: [
            // For binary questions
            {
              type: QuestionType.BINARY,
              resolution: {
                in: [Resolution.YES, Resolution.NO],
              },
            },
            // For multiple choice questions
            {
              type: QuestionType.MULTIPLE_CHOICE,
              options: {
                some: {
                  resolution: {
                    in: [Resolution.YES, Resolution.NO],
                  },
                },
              },
            },
          ],
        },
        {
          forecasts: {
            some: {
              userId: {
                equals: userId,
              },
              ...ENDORSED_ONLY,
            },
          },
        },
        tags && tags.length > 0
          ? {
              tags: {
                some: {
                  name: {
                    in: tags,
                  },
                  userId: userId,
                },
              },
            }
          : {},
      ],
    },
    include: {
      options: {
        where: {
          resolution: {
            in: [Resolution.YES, Resolution.NO],
          },
        },
        include: {
          forecasts: {
            where: {
              userId: {
                equals: userId,
              },
              ...ENDORSED_ONLY,
            },
          },
        },
      },
      forecasts: {
        where: {
          userId: {
            equals: userId,
          },
          ...ENDORSED_ONLY,
        },
      },
    },
  })

  if (!questions) {
    return undefined
  }

  function excludeForecastsCreatedInLastMinuteBySameUser(
    f: Forecast,
    forecasts: Forecast[],
  ) {
    return !forecasts.some((f2) => {
      const timeDiff = f2.createdAt.getTime() - f.createdAt.getTime()
      return f !== f2 && timeDiff < 1000 * 60 && timeDiff > 0
    })
  }

  const forecasts = questions
    .filter((q) => q.type === QuestionType.BINARY)
    .flatMap((q) =>
      q.forecasts
        .filter((f) =>
          excludeForecastsCreatedInLastMinuteBySameUser(f, q.forecasts),
        )
        // ADR-0031 §六：无来源且由他人确认的结算不进校准（悬空）
        .filter((f) => countsTowardMetrics(q, f.userId))
        .map((f) => ({
          forecast: f.forecast.toNumber(),
          resolution: q.resolution,
        })),
    )

  const mcqForecasts = questions
    .filter(
      (q) =>
        q.type === QuestionType.MULTIPLE_CHOICE &&
        (!q.resolution || q.resolution != Resolution.AMBIGUOUS), // Exclude ambiguous questions
    )
    .flatMap((q) =>
      q.options
        // Only include options that have resolutions
        .filter((option) => option.resolvedAt)
        .flatMap((option) =>
          option.forecasts
            .filter((f) =>
              excludeForecastsCreatedInLastMinuteBySameUser(
                f,
                option.forecasts,
              ),
            )
            // ADR-0031 §六：同二进制题，悬空样本不进校准
            .filter((f) => countsTowardMetrics(q, f.userId))
            .map((f) => ({
              forecast: f.forecast.toNumber(),
              resolution: option.resolution,
            })),
        ),
    )

  forecasts.push(...mcqForecasts)

  // 分桶只有一处定义（`calibrationBinsOf`）：这里曾经是第二份实现，与领域读数各写
  // 一遍，靠“同口径”那句话维系——而那句话不会在有人只改一边时报错。
  const bucketedForecasts = calibrationBinsOf(forecasts, {
    forecastOf: (f) => f.forecast,
    outcomeOf: (f) => (f.resolution === Resolution.YES ? 1 : 0),
  })

  return { bucketedForecasts }
}
