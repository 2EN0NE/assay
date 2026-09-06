import { z } from "zod"

export const parsedDecisionSchema = z.object({
  title: z.string().min(1),
  forecast: z.number().min(0).max(1),
  resolveBy: z.string().min(1),
})

export type ParsedDecision = z.infer<typeof parsedDecisionSchema>

/**
 * Extract the first JSON object from an LLM response, tolerating
 * markdown code fences and surrounding prose.
 */
export function extractJson(content: string): string {
  // Strip markdown code fences if present
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) {
    return fenced[1].trim()
  }
  // Otherwise find the first balanced-ish {...} block
  const start = content.indexOf("{")
  const end = content.lastIndexOf("}")
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in LLM response")
  }
  return content.slice(start, end + 1)
}

/**
 * Parse an LLM response into a structured decision.
 * Throws if the response is not a valid structured decision.
 */
export function parseDecisionResponse(content: string): ParsedDecision {
  const json = extractJson(content)
  const parsed = JSON.parse(json)
  return parsedDecisionSchema.parse(parsed)
}

export function buildParsePrompt(text: string): string {
  return `You are a decision-parsing assistant. Given a natural-language decision or prediction, extract a structured representation.

Rules:
- "title" is a concise, verifiable statement of the decision/prediction (a yes/no question).
- "forecast" is the user's confidence as a number between 0 and 1 (e.g. "70% sure" -> 0.7). If no confidence is given, use 0.5.
- "resolveBy" is an ISO date (YYYY-MM-DD) for when the outcome will be known. If no date is given, default to 7 days from today.

Respond with ONLY a JSON object, no prose, with exactly these keys: title, forecast, resolveBy.

Decision text: ${text}`
}

export type LlmClient = (prompt: string) => Promise<string>

export async function parseDecisionWithLlm(
  text: string,
  llm: LlmClient,
): Promise<ParsedDecision> {
  const prompt = buildParsePrompt(text)
  const response = await llm(prompt)
  return parseDecisionResponse(response)
}

/**
 * Default LLM client backed by the Kimi (Moonshot) API.
 * Requires KIMI_CODING_API_KEY in the environment.
 */
export async function kimiLlmClient(prompt: string): Promise<string> {
  const apiKey = process.env.KIMI_CODING_API_KEY
  if (!apiKey) {
    throw new Error("KIMI_CODING_API_KEY is not set")
  }

  const model = process.env.KIMI_MODEL || "moonshot-v1-8k"
  const res = await fetch("https://api.moonshot.cn/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Kimi API error ${res.status}: ${body}`)
  }

  const data = (await res.json()) as {
    choices: { message: { content: string } }[]
  }
  const content = data.choices?.[0]?.message?.content
  if (!content) {
    throw new Error("Kimi API returned an empty response")
  }
  return content
}

export async function parseDecision(text: string): Promise<ParsedDecision> {
  return await parseDecisionWithLlm(text, kimiLlmClient)
}
