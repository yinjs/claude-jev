import { expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { timeline } from "./done-check"

function transcript(rows: unknown[]): string {
  const path = join(mkdtempSync(join(tmpdir(), "done-check-")), "t.jsonl")
  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join("\n") + "\nnot json\n")
  return path
}

const prompt = (text: string) => ({ type: "user", message: { content: text } })
const use = (id: string, name: string, input: object) => ({
  type: "assistant",
  message: { content: [{ type: "tool_use", id, name, input }] },
})
const result = (id: string, is_error = false) => ({
  type: "user",
  message: { content: [{ type: "tool_result", tool_use_id: id, is_error }] },
})

test("keeps only the current turn's edits and commands, with their errors", () => {
  const path = transcript([
    prompt("first request"),
    use("a", "Edit", { file_path: "old.ts" }),
    prompt("second request"),
    use("b", "Bash", { command: "bun test" }),
    result("b", true),
    use("c", "Write", { file_path: "new.ts" }),
    result("c"),
    use("d", "Read", { file_path: "ignored.ts" }),
  ])
  expect(timeline(path)).toEqual({
    entries: [
      { tool: "command", detail: "bun test", is_error: true },
      { tool: "edit", detail: "new.ts", is_error: false },
    ],
    edited: true,
  })
})

test("a prompt sent as text parts also starts a new turn", () => {
  const path = transcript([
    use("a", "Edit", { file_path: "old.ts" }),
    { type: "user", message: { content: [{ type: "text", text: "next" }] } },
    use("b", "Bash", { command: "ls" }),
  ])
  expect(timeline(path)).toEqual({ entries: [{ tool: "command", detail: "ls" }], edited: false })
})

test("a missing transcript reads as no edits", () => {
  expect(timeline("/nonexistent/t.jsonl")).toEqual({ entries: [], edited: false })
  expect(timeline(undefined)).toEqual({ entries: [], edited: false })
})
