import {
  CliError,
  emitJson,
  hasFlag,
  installStdoutGuard,
  optionalNumber,
  optionalProbability,
  optionalString,
  parseArgs,
  requireDate,
  requireString,
} from "./args"

/** `instanceof` 收窄，避免类型断言。 */
function captureCliError(fn: () => unknown): CliError | null {
  try {
    fn()
    return null
  } catch (error) {
    return error instanceof CliError ? error : null
  }
}

describe("parseArgs", () => {
  it("parses --key value, --key=value and bare flags", () => {
    const args = parseArgs(["--title", "接 offer", "--limit=10", "--accept"])
    expect(args.flags["title"]).toBe("接 offer")
    expect(args.flags["limit"]).toBe("10")
    expect(args.flags["accept"]).toBe(true)
  })

  it("does not swallow a following flag as a value", () => {
    // `--note --probability 0.7` 里 note 没有值，不能把 --probability 吃成它的值
    const args = parseArgs(["--note", "--probability", "0.7"])
    expect(args.flags["note"]).toBe(true)
    expect(args.flags["probability"]).toBe("0.7")
  })

  it("keeps positional arguments separate from flags", () => {
    const args = parseArgs(["list-due", "--limit", "5"])
    expect(args.positional).toEqual(["list-due"])
  })
})

describe("validators", () => {
  it("requireString names the missing flag", () => {
    expect(() => requireString(parseArgs([]), "title")).toThrow(CliError)
    expect(() => requireString(parseArgs([]), "title")).toThrow(/--title/)
  })

  it("optionalString returns undefined when absent, but rejects a bare flag", () => {
    expect(optionalString(parseArgs([]), "note")).toBeUndefined()
    expect(() => optionalString(parseArgs(["--note"]), "note")).toThrow(
      /--note/,
    )
  })

  it("optionalNumber rejects non-numeric input", () => {
    expect(optionalNumber(parseArgs(["--limit", "12"]), "limit")).toBe(12)
    expect(() =>
      optionalNumber(parseArgs(["--limit", "abc"]), "limit"),
    ).toThrow(/--limit/)
  })

  it("requireDate rejects garbage and carries an actionable hint", () => {
    expect(
      requireDate(parseArgs(["--resolve-by", "2026-03-01"]), "resolve-by"),
    ).toBeInstanceOf(Date)

    expect(() =>
      requireDate(parseArgs(["--resolve-by", "tomorrow"]), "resolve-by"),
    ).toThrow(CliError)
    // hint 是独立属性（渲染到 stderr 的第二行），不在 message 里
    expect(
      captureCliError(() =>
        requireDate(parseArgs(["--resolve-by", "tomorrow"]), "resolve-by"),
      )?.hint,
    ).toMatch(/ISO 8601/)
  })

  it("optionalProbability accepts decimals and percent, rejects out-of-range", () => {
    expect(
      optionalProbability(parseArgs(["--probability", "0.7"]), "probability"),
    ).toBe(0.7)
    expect(
      optionalProbability(parseArgs(["--probability", "70%"]), "probability"),
    ).toBeCloseTo(0.7)
    // 裸 70 是歧义输入，必须报错而不是当成 70 倍
    expect(() =>
      optionalProbability(parseArgs(["--probability", "70"]), "probability"),
    ).toThrow(/0–1/)
  })

  it("stdout 守卫：非 emitJson 的写入当场抱错，emitJson 自身放行", () => {
    const original = process.stdout.write
    const written: string[] = []
    process.stdout.write = ((chunk: string) => {
      written.push(chunk)
      return true
    }) as typeof process.stdout.write

    try {
      installStdoutGuard()
      expect(() => process.stdout.write("leak")).toThrow(/stdout/)
      emitJson({ ok: true })
      expect(written.join("")).toContain('"ok": true')
    } finally {
      process.stdout.write = original
    }
  })

  it("hasFlag is true only for bare flags", () => {
    expect(hasFlag(parseArgs(["--accept"]), "accept")).toBe(true)
    expect(hasFlag(parseArgs(["--accept", "yes"]), "accept")).toBe(false)
  })

  it("optionalProbability 拒绝空值与裸 %，而不是静默当成 0", () => {
    // Number("") === 0 且 Number.isFinite(0) 为真：不显式拦就会写成「0% 几乎确定不发生」
    expect(() =>
      optionalProbability(parseArgs(["--probability", ""]), "probability"),
    ).toThrow(CliError)
    expect(() =>
      optionalProbability(parseArgs(["--probability", "%"]), "probability"),
    ).toThrow(CliError)
    expect(() =>
      optionalProbability(parseArgs(["--probability", "  "]), "probability"),
    ).toThrow(CliError)
    // 0 本身是合法概率，但必须显式写出
    expect(
      optionalProbability(parseArgs(["--probability", "0"]), "probability"),
    ).toBe(0)
  })
})
