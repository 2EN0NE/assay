import { parseDecisionResponse } from "./llm_parse"

describe("parseDecisionResponse", () => {
  it("parses a well-formed JSON response into a structured decision", () => {
    const content = `{
      "title": "Complete the project by Friday",
      "forecast": 0.7,
      "resolveBy": "2026-09-12"
    }`
    const result = parseDecisionResponse(content)
    expect(result).toEqual({
      title: "Complete the project by Friday",
      forecast: 0.7,
      resolveBy: "2026-09-12",
    })
  })

  it("extracts JSON even when the LLM wraps it in markdown fences", () => {
    const content = `Here is the parsed result:
\`\`\`json
{"title": "Ship the feature", "forecast": 0.5, "resolveBy": "2026-10-01"}
\`\`\``
    const result = parseDecisionResponse(content)
    expect(result.title).toBe("Ship the feature")
    expect(result.forecast).toBe(0.5)
  })

  it("clamps forecast probability to the 0..1 range", () => {
    const content = `{"title": "x", "forecast": 1.5, "resolveBy": "2026-09-12"}`
    expect(() => parseDecisionResponse(content)).toThrow()
  })

  it("rejects responses missing required fields", () => {
    const content = `{"title": "only a title"}`
    expect(() => parseDecisionResponse(content)).toThrow()
  })
})
