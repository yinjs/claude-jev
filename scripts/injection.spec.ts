import { expect, test } from "bun:test"
import { shellFetches } from "./injection"

test("scans Bash output only when the command downloads something", () => {
  expect(shellFetches("curl -s https://example.com/notes")).toBe(true)
  expect(shellFetches("wget -qO- example.com")).toBe(true)
  expect(shellFetches("gh api repos/x/y/issues")).toBe(true)
  expect(shellFetches("git status")).toBe(false)
  expect(shellFetches(undefined)).toBe(false)
})
