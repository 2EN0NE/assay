import {
  buildParsePrompt,
  extractJson,
  kimiLlmClient,
  parseDecisionResponse,
  parseDecisionWithLlm,
} from "./llm_parse"

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

describe("extractJson", () => {
  it("extracts the first JSON object wrapped in surrounding prose", () => {
    expect(extractJson(`Sure, here is { "title": "a" } thanks`)).toBe(
      `{ "title": "a" }`,
    )
  })

  it("strips markdown fences without a language tag", () => {
    expect(extractJson('```\n{"title":"a"}\n```')).toBe(`{"title":"a"}`)
  })

  it("throws when no JSON object is present", () => {
    expect(() => extractJson("no braces anywhere")).toThrow(
      "No JSON object found in LLM response",
    )
  })
})

describe("buildParsePrompt", () => {
  it("embeds the decision text in the prompt", () => {
    const prompt = buildParsePrompt("Will it rain tomorrow?")
    expect(prompt).toContain("Will it rain tomorrow?")
    expect(prompt).toContain("title")
    expect(prompt).toContain("forecast")
    expect(prompt).toContain("resolveBy")
  })
})

describe("parseDecisionWithLlm", () => {
  it("parses a well-formed LLM response", async () => {
    const result = await parseDecisionWithLlm("text", () =>
      Promise.resolve(`{"title":"t","forecast":0.5,"resolveBy":"2026-09-12"}`),
    )
    expect(result).toEqual({
      title: "t",
      forecast: 0.5,
      resolveBy: "2026-09-12",
    })
  })

  it("propagates LLM errors", async () => {
    await expect(
      parseDecisionWithLlm("text", () => Promise.reject(new Error("llm down"))),
    ).rejects.toThrow("llm down")
  })
})

describe("kimiLlmClient", () => {
  const originalFetch = global.fetch
  const originalKey = process.env.KIMI_CODING_API_KEY

  afterEach(() => {
    global.fetch = originalFetch
    if (originalKey === undefined) {
      delete process.env.KIMI_CODING_API_KEY
    } else {
      process.env.KIMI_CODING_API_KEY = originalKey
    }
  })

  it("throws when KIMI_CODING_API_KEY is not set", async () => {
    delete process.env.KIMI_CODING_API_KEY
    await expect(kimiLlmClient("prompt")).rejects.toThrow(
      "KIMI_CODING_API_KEY is not set",
    )
  })

  it("throws on a non-2xx API response", async () => {
    process.env.KIMI_CODING_API_KEY = "test-key"
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("server error"),
    }) as unknown as typeof fetch

    await expect(kimiLlmClient("prompt")).rejects.toThrow("Kimi API error 500")
  })

  it("throws on an empty choices payload", async () => {
    process.env.KIMI_CODING_API_KEY = "test-key"
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [] }),
    }) as unknown as typeof fetch

    await expect(kimiLlmClient("prompt")).rejects.toThrow(
      "Kimi API returned an empty response",
    )
  })

  it("returns the message content on success", async () => {
    process.env.KIMI_CODING_API_KEY = "test-key"
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ choices: [{ message: { content: "{}" } }] }),
    }) as unknown as typeof fetch

    await expect(kimiLlmClient("prompt")).resolves.toBe("{}")
  })
})
