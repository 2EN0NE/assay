import { DayOfTheWeek, Target, TargetType } from "@prisma/client"
import fetch from "node-fetch"
import { TEST_WORKSPACES } from "./_constants"
import { log } from "./_log"
import { prisma } from "./prisma"

// tokenize a string into an array by splitting on sections
// in the following syntax, with two strings and one number:
// "forecast" "date" 0.8
export function tokenizeForecastString(instring: string): string[] | null {
  const regex = /([a-zA-Z_]+)\s?(["“][^"”]*["”])?\s?("?[^"\s]*"?)?\s?([\d.]*)?/
  const array: string[] | null = instring.match(regex)
  return array
}

export function tokenizeString(instring: string) {
  const array: string[] = instring.split(" ").filter((element) => {
    return element !== ""
  })
  return array
}

export interface AnalyticsEventParams {
  platform: "web" | "api"
  team?: string
  [key: string]: any
}
export async function backendAnalyticsEvent(
  name: string,
  params: AnalyticsEventParams,
) {
  const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID
  const apiSecret = process.env.G_ANALYTICS_MEASUREMENT_PROTOCOL_SECRET

  if (
    process.env.NODE_ENV !== "production" ||
    (params.team && TEST_WORKSPACES.includes(params.team))
  ) {
    log(
      "Skipping analytics event because test workspace or not in production: ",
      name,
    )
    return
  }

  if (!measurementId || !apiSecret) {
    log(
      "Missing g analytics measurement ID or API secret. (Ignore unless in production)",
    )
    return
  }

  const res = await fetch(
    `https://www.google-analytics.com/mp/collect?measurement_id=${measurementId}&api_secret=${apiSecret}`,
    {
      method: "POST",
      body: JSON.stringify({
        client_id: "nano-fatebook-agent-backend",
        events: [
          {
            name,
            params: {
              session_id: Date.now() + 123, // There's a limit of 500 events per session so need to be ~unique
              engagement_time_msec: 100,
              ...params,
            },
          },
        ],
      }),
    },
  )
  if (!res.ok) {
    log("Error sending analytics event", res.text(), res)
  }
}

export async function userHasTarget(fatebookUserId: string) {
  return (await getTarget(fatebookUserId)) !== null
}

export async function getTarget(fatebookUserId: string) {
  return await prisma.target.findFirst({
    where: {
      userId: fatebookUserId,
    },
  })
}

export function dateToDayEnum(date: Date): DayOfTheWeek {
  const dayNumber = date.getDay()
  switch (dayNumber) {
    case 0:
      return DayOfTheWeek.SUNDAY
    case 1:
      return DayOfTheWeek.MONDAY
    case 2:
      return DayOfTheWeek.TUESDAY
    case 3:
      return DayOfTheWeek.WEDNESDAY
    case 4:
      return DayOfTheWeek.THURSDAY
    case 5:
      return DayOfTheWeek.FRIDAY
    case 6:
      return DayOfTheWeek.SATURDAY
    default:
      throw new Error("Invalid day number")
  }
}

export function dayEnumToNum(day: DayOfTheWeek): number {
  switch (day) {
    case DayOfTheWeek.SUNDAY:
      return 0
    case DayOfTheWeek.MONDAY:
      return 1
    case DayOfTheWeek.TUESDAY:
      return 2
    case DayOfTheWeek.WEDNESDAY:
      return 3
    case DayOfTheWeek.THURSDAY:
      return 4
    case DayOfTheWeek.FRIDAY:
      return 5
    case DayOfTheWeek.SATURDAY:
      return 6
    default:
      throw new Error("Invalid day enum")
  }
}

export function dayEnumToStr(day: DayOfTheWeek): string {
  switch (day) {
    case DayOfTheWeek.SUNDAY:
      return "Sunday"
    case DayOfTheWeek.MONDAY:
      return "Monday"
    case DayOfTheWeek.TUESDAY:
      return "Tuesday"
    case DayOfTheWeek.WEDNESDAY:
      return "Wednesday"
    case DayOfTheWeek.THURSDAY:
      return "Thursday"
    case DayOfTheWeek.FRIDAY:
      return "Friday"
    case DayOfTheWeek.SATURDAY:
      return "Saturday"
    default:
      throw new Error("Invalid day enum")
  }
}

export function sameDate(date1: Date, date2: Date) {
  return (
    date1.getFullYear() == date2.getFullYear() &&
    date1.getMonth() == date2.getMonth() &&
    date1.getDate() == date2.getDate()
  )
}

export async function getCurrentTargetProgress(
  fatebookUserId: string,
  target: Target,
) {
  let count = 0
  let previousPeriodStart = target.lastNotified
  switch (target.type) {
    case TargetType.FORECAST:
      count = await prisma.forecast.count({
        where: {
          userId: fatebookUserId,
          createdAt: {
            gte: previousPeriodStart,
          },
        },
      })
      break
    case TargetType.QUESTION:
      count = await prisma.question.count({
        where: {
          userId: fatebookUserId,
          createdAt: {
            gte: previousPeriodStart,
          },
        },
      })
      break
    default:
      throw new Error(`Unknown target type ${target.type}`)
  }
  return count
}
