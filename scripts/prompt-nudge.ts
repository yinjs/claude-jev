#!/usr/bin/env bun
// UserPromptSubmit: nudge Claude to plan first on large/risky requests, or to ask on vague
// ones. Adds context only; never blocks the prompt. Skips slash commands and short replies.

import { clip, decide, emit, log, noul, readInput } from "./lib"

// The whole Jev call, retries included; must stay under this hook's timeout in hooks/hooks.json.
export const BUDGET_MS = 6_000

type Input = { prompt?: string }

// Wordings tuned against live Jev (see the Hermes jev plugin): broad "underspecified?" questions
// scored everything ~0.5; the concrete-target test separates vague from specific requests.
const QUESTIONS = {
  vague: {
    type: "noul" as const,
    instructions:
      "`request` asks for a change but names neither a concrete thing to change nor a concrete desired " +
      "result (for example only 'make it better', 'improve this', 'build something cool').",
  },
  large: {
    type: "noul" as const,
    instructions:
      "`request` asks for a large or risky multi-step change (new feature spanning many files, migration, " +
      "architecture change, production operation) that deserves a plan before acting.",
  },
}

async function main() {
  if (process.env.JEV_DISABLE === "1") return
  const { prompt = "" } = await readInput<Input>()
  const text = prompt.trim()
  // Slash commands, and short replies like "yes go ahead" (which Jev can't judge without context).
  if (!text || text.startsWith("/") || text.split(/\s+/).length < 3) return
  const answers = await decide({ request: clip(text, 12_000) }, QUESTIONS, BUDGET_MS)
  const vague = noul(answers, "vague")
  const large = noul(answers, "large")
  log("prompt", { vague, large, words: text.split(/\s+/).length })
  // Phrased as facts, not commands: Claude Code's hooks reference warns that context framed as
  // out-of-band system instructions can trip Claude's injection defenses and get surfaced to
  // the user instead of being used.
  let note: string | undefined
  if (large !== undefined && large >= 0.85)
    note = `Jev, the classifier these hooks call, rates this request p=${large.toFixed(2)} a large or risky ` +
      "multi-step change. For changes of that size this setup expects a short plan, and the user's " +
      "confirmation of its key decisions, before any edit (the grill-me approach fits)."
  else if (vague !== undefined && vague >= 0.9)
    note = `Jev, the classifier these hooks call, rates this request p=${vague.toFixed(2)} as naming no ` +
      "concrete thing to change and no concrete result. For requests like that this setup expects 1-3 " +
      "focused questions to the user, or explicitly stated assumptions, before acting."
  if (note) emit({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: note } })
}

if (import.meta.main) main().catch((e) => log("crash", { hook: "prompt-nudge", error: String(e) }))
