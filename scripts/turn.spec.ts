import { expect, test } from "bun:test"
import { applied, questionsFor } from "./turn"

test("asks nothing for a slash command or an undefined question", () => {
  expect(questionsFor("/jev-route off now", ["effort"])).toEqual([])
  expect(questionsFor("add a test", ["effort", "bogus"])).toEqual(["effort"])
})

test("applies only a defined choice at confidence 0.7 or above", () => {
  const asked = ["effort", "agent"]
  expect(
    applied(
      {
        effort: { choice: "low", confidence: 0.7 },
        agent: { choice: "opus", confidence: 0.69 },
      },
      asked,
    ),
  ).toEqual({ effort: "low" })
  expect(applied({ effort: { choice: "haiku", confidence: 1 } }, asked)).toEqual({})
  expect(applied({}, asked)).toEqual({})
})

test("reports a call with no response as failed, not as unsure", () => {
  expect(applied(undefined, ["effort"])).toEqual({ failed: expect.stringContaining("no response") })
})
