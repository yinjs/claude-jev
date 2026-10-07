#!/usr/bin/env bun
// Stop: catch "tests pass / it works" claims with no check run after the last edit, and "done"
// answers that leave stubs or TODOs. Continues the turn once (stop_hook_active guards loops).

import { readFileSync } from "node:fs"
import { clip, decide, emit, log, noul, readInput } from "./lib"

// The whole Jev call, retries included; must stay under this hook's timeout in hooks/hooks.json.
export const BUDGET_MS = 10_000

type Input = { stop_hook_active?: boolean; last_assistant_message?: string; transcript_path?: string }

const CHECK_WORDS =
  /\b(pytest|tests?|jest|vitest|bun test|go test|cargo test|npm (run )?test|tsc|mypy|ruff|lint|build|make|compile|type ?check|verified|works now)\b/i

const QUESTIONS = {
  unverified_claim: {
    type: "noul" as const,
    instructions:
      "`final_response` claims that tests, builds, type checks, or lints pass (or that the change was " +
      "verified or works), but no entry in `timeline` AFTER the last `edit` entry ran such a check.",
  },
  unfinished: {
    type: "noul" as const,
    instructions:
      "`final_response` presents the task as complete while describing or implying unfinished work: " +
      "stubs, placeholders, TODOs, mocked-out parts, or steps it skipped.",
  },
}

type Entry = { tool: "edit" | "command"; detail: string; is_error?: boolean }

// ponytail: in-place sed/perl, tee, and redirects into a file; an edit hidden behind a script it runs
// is missed. Parse the shell if that gap shows up in the log.
const SHELL_EDIT = /\b(sed|perl)\b[^|;&]*\s-[a-zA-Z]*i|\btee\b|(^|[^\d&>=-])>>?\s*(?!&|\/dev\/null)[\w.~\/"'-]/
export const shellEdits = (command: string) => SHELL_EDIT.test(command)

// Edits and Bash commands from the current turn (since the last real user message).
export function timeline(path?: string): { entries: Entry[]; edited: boolean } {
  if (!path) return { entries: [], edited: false }
  let lines: string[]
  try {
    lines = readFileSync(path, "utf8").trim().split("\n")
  } catch {
    return { entries: [], edited: false }
  }
  const entries: Entry[] = []
  const byId = new Map<string, Entry>()
  for (const line of lines) {
    let d: any
    try {
      d = JSON.parse(line)
    } catch {
      continue
    }
    const content = d?.message?.content
    if (d.type === "user" && typeof content === "string") {
      entries.length = 0 // a new human prompt starts a new turn
      byId.clear()
      continue
    }
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (d.type === "user" && part?.type === "text" && !content.some((p: any) => p?.type === "tool_result")) {
        entries.length = 0
        byId.clear()
      }
      if (part?.type === "tool_use") {
        const name = part.name as string
        const inp = part.input ?? {}
        let e: Entry | undefined
        if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(name)) e = { tool: "edit", detail: String(inp.file_path ?? "").slice(0, 200) }
        else if (name === "Bash") {
          const command = String(inp.command ?? "")
          e = { tool: shellEdits(command) ? "edit" : "command", detail: command.slice(0, 300) }
        }
        if (e) {
          entries.push(e)
          byId.set(part.id, e)
        }
      } else if (part?.type === "tool_result" && byId.has(part.tool_use_id)) {
        byId.get(part.tool_use_id)!.is_error = Boolean(part.is_error)
      }
    }
  }
  return { entries, edited: entries.some((e) => e.tool === "edit") }
}

async function main() {
  if (process.env.JEV_DISABLE === "1") return
  const input = await readInput<Input>()
  if (input.stop_hook_active) return
  const final = input.last_assistant_message ?? ""
  if (!final.trim()) return
  const { entries, edited } = timeline(input.transcript_path)
  if (!edited) return // only police turns that changed files
  const claimsCheck = CHECK_WORDS.test(final)
  const answers = await decide({ final_response: clip(final, 12_000), timeline: entries.slice(-40) }, QUESTIONS, BUDGET_MS)
  const pClaim = noul(answers, "unverified_claim")
  const pUnfinished = noul(answers, "unfinished")
  log("done_check", { p_claim: pClaim, p_unfinished: pUnfinished, claims_check: claimsCheck, timeline: entries.length })
  const reasons: string[] = []
  if (claimsCheck && pClaim !== undefined && pClaim >= 0.85)
    reasons.push("your answer says checks pass or the change works, but nothing after your last edit ran those checks. Run them now and report the real result")
  if (pUnfinished !== undefined && pUnfinished >= 0.85)
    reasons.push("your answer reads as done but mentions or implies unfinished parts (stubs, TODOs, skipped steps). Finish them, or say plainly what is left and why")
  if (!reasons.length) return
  // Only a block continues the turn; additionalContext on Stop is shown as feedback and Claude stops anyway.
  emit({ decision: "block", reason: "[jev done-check] Before finishing: " + reasons.join("; and ") + "." })
}

if (import.meta.main) main().catch((e) => log("crash", { hook: "done-check", error: String(e) }))
