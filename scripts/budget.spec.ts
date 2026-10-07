import { expect, test } from "bun:test"
import hooks from "../hooks/hooks.json"

// Claude Code kills a hook at its timeout, and a killed hook loses its decision outright, so each
// script's Jev budget leaves a second for bun startup, stdin and output.
test("every hook's Jev budget fits under its timeout", async () => {
  const entries = Object.values(hooks.hooks).flat().flatMap((m) => m.hooks)
  expect(entries).toHaveLength(4)
  for (const { command, timeout } of entries) {
    const script = command.match(/scripts\/([\w-]+\.ts)/)![1]
    const { BUDGET_MS } = await import(`./${script}`)
    expect(BUDGET_MS + 1000, script).toBeLessThanOrEqual(timeout * 1000)
  }
})
