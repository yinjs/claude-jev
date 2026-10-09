import { expect, test } from "bun:test"
import { summarize } from "./stats"

const now = Date.parse("2026-10-09T12:00:00Z")
const line = (e: object) => JSON.stringify({ ts: "2026-10-08T12:00:00Z", ...e })

test("counts results and buckets probabilities", () => {
  const out = summarize(
    [
      line({ feature: "permission", tool: "Bash", safe: 0.95, destructive: 0.02, result: "allow", ms: 900 }),
      line({ feature: "permission", tool: "Bash", safe: 0.85, destructive: 0.1, result: "prompt", ms: 1100 }),
      line({ feature: "permission", tool: "WebFetch", read_only: 0.3, result: "prompt" }),
      line({ feature: "injection", tool: "WebFetch", p: 0.82 }),
      line({ feature: "error", error: "timeout" }),
      "not json",
    ],
    now - 7 * 86_400_000,
  )
  expect(out).toContain("permission results: prompt 2, allow 1")
  expect(out).toContain("permission.safe n=2: >=0.9 1, 0.8-0.9 1, 0.5-0.8 0, <0.5 0")
  expect(out).toContain("injection.p n=1: >=0.9 0, 0.8-0.9 1")
  expect(out).toContain("failures: 1")
})

test("drops entries before the window and reports an empty log", () => {
  expect(summarize([line({ feature: "prompt", vague: 0.9 })], now)).toBe("no log entries in this window")
  expect(summarize([], 0)).toBe("no log entries in this window")
})
