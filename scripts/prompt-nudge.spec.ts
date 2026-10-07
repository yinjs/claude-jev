import { expect, test } from "bun:test"
import { nudgeNote } from "./prompt-nudge"

test("a large request asks for a plan, and wins over a vague one", () => {
  expect(nudgeNote(0.85, 0.95)).toContain("short plan")
  expect(nudgeNote(0.84, undefined)).toBeUndefined()
})

test("a vague request asks for questions only at p >= 0.9", () => {
  expect(nudgeNote(undefined, 0.9)).toContain("focused questions")
  expect(nudgeNote(0.5, 0.89)).toBeUndefined()
})
