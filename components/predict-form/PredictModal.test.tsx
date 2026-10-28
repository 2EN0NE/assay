import "@testing-library/jest-dom" // Must import to expose some functions like .toBeInTheDocument()
import { act, render } from "@testing-library/react"
import { RefObject } from "react"
import PredictModal from "./PredictModal"

// Render a real textarea so the message listener actually registers.
jest.mock("./Predict", () => ({
  Predict: ({
    textAreaRef,
  }: {
    textAreaRef: RefObject<HTMLTextAreaElement>
  }) => <textarea ref={textAreaRef} data-testid="predict-textarea" />,
}))

jest.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}))

describe("PredictModal", () => {
  it("ignores postMessage events whose data is null", () => {
    const { getByTestId } = render(<PredictModal />)
    expect(getByTestId("predict-textarea")).toBeInTheDocument()

    // Regression: event.data can be null; reading .isAssay must not throw.
    expect(() => {
      act(() => {
        window.dispatchEvent(new MessageEvent("message", { data: null }))
      })
    }).not.toThrow()
  })

  it("focuses the textarea on a valid focus_modal message", () => {
    const { getByTestId } = render(<PredictModal />)
    const textarea = getByTestId("predict-textarea")

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { isAssay: true, action: "focus_modal" },
        }),
      )
    })

    expect(document.activeElement).toBe(textarea)
  })
})
