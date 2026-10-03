import { expect, test } from "bun:test"
import { applied, questionsFor } from "./turn"

test("asks no tier for a prompt under three words, nothing for a slash command", () => {
  expect(questionsFor("hi there", ["effort", "tier"])).toEqual(["effort"])
  expect(questionsFor("add a test", ["effort", "tier"])).toEqual(["effort", "tier"])
  expect(questionsFor("/jev-route off now", ["effort"])).toEqual([])
  expect(questionsFor("add a test", ["effort", "bogus"])).toEqual(["effort"])
})

test("applies only a defined choice at confidence 0.7 or above", () => {
  const asked = ["effort", "tier", "agent"]
  expect(
    applied(
      {
        effort: { choice: "low", confidence: 0.7 },
        tier: { choice: "haiku", confidence: 1 },
        agent: { choice: "opus", confidence: 0.69 },
      },
      asked,
    ),
  ).toEqual({ effort: "low" })
  expect(applied({}, asked)).toEqual({})
})

test("reports a call with no response as failed, not as unsure", () => {
  expect(applied(undefined, ["effort"])).toEqual({ failed: expect.stringContaining("no response") })
})
