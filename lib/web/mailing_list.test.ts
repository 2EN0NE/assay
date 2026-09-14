import { warn } from "../_log"
import { subscribeToMailingListSafely } from "./mailing_list"

jest.mock("../_log", () => ({
  __esModule: true,
  log: jest.fn(),
  warn: jest.fn(),
}))

const warnMock = warn as jest.Mock

beforeEach(() => {
  warnMock.mockClear()
})

describe("subscribeToMailingListSafely（注册流程的营销副作用兜底）", () => {
  it("订阅成功：透传 email/name，不发警告", async () => {
    const subscribe = jest.fn().mockResolvedValue(undefined)

    await subscribeToMailingListSafely(subscribe, "a@example.com", "A")

    expect(subscribe).toHaveBeenCalledWith("a@example.com", "A")
    expect(warnMock).not.toHaveBeenCalled()
  })

  it("订阅被拒：函数照样正常返回，并记一条警告", async () => {
    const subscribe = jest
      .fn()
      .mockRejectedValue(new Error("MAILING_LIST_SECRET is not set"))

    await expect(
      subscribeToMailingListSafely(subscribe, "a@example.com"),
    ).resolves.toBeUndefined()

    expect(warnMock).toHaveBeenCalledWith(
      expect.stringContaining("MAILING_LIST_SECRET is not set"),
    )
  })

  it("拒绝不留 unhandledRejection——这正是当初把整个注册页盖住的原因", async () => {
    const onUnhandled = jest.fn()
    process.on("unhandledRejection", onUnhandled)
    try {
      await subscribeToMailingListSafely(
        () => Promise.reject(new Error("boom")),
        "a@example.com",
      )
      // 让微任务队列跑完，任何漏网的 rejection 此时都会触发监听器
      await new Promise((resolve) => setTimeout(resolve, 0))
    } finally {
      process.off("unhandledRejection", onUnhandled)
    }

    expect(onUnhandled).not.toHaveBeenCalled()
  })

  it("非 Error 的拒绝也兜住（字符串 / undefined），且不抛", async () => {
    await expect(
      subscribeToMailingListSafely(
        () => Promise.reject("plain string"),
        "a@b.c",
      ),
    ).resolves.toBeUndefined()
    await expect(
      subscribeToMailingListSafely(() => Promise.reject(undefined), "a@b.c"),
    ).resolves.toBeUndefined()

    expect(warnMock).toHaveBeenCalledTimes(2)
  })
})
