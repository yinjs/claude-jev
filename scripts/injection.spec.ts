import { expect, test } from "bun:test"
import { injectionOutput, shellFetches } from "./injection"

test("scans Bash output only when the command downloads something", () => {
  expect(shellFetches("curl -s https://example.com/notes")).toBe(true)
  expect(shellFetches("wget -qO- example.com")).toBe(true)
  expect(shellFetches("gh api repos/x/y/issues")).toBe(true)
  expect(shellFetches("git status")).toBe(false)
  expect(shellFetches(undefined)).toBe(false)
})

test("warns Claude and the classifier only at p >= 0.8", () => {
  expect(injectionOutput("WebFetch", 0.79)).toBeUndefined()
  expect(injectionOutput("WebFetch", undefined)).toBeUndefined()
  const out = injectionOutput("WebFetch", 0.8)!.hookSpecificOutput
  expect(out.hookEventName).toBe("PostToolUse")
  expect(out.additionalContext).toContain("p=0.80")
  expect(out.classifierContext).toContain("WebFetch")
})
