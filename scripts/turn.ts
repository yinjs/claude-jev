#!/usr/bin/env bun
// Jev decisions for the jev-route module (../hooks/register.ts). Reads a TurnRequest on stdin and
// prints a Decision (./contract.ts): {} when Jev is unsure, `failed` when it gave no answer at all,
// so the module changes nothing either way. The questions and thresholds live here; the module
// only applies what this prints.

import { TURN_BUDGET_MS, type Decision, type TurnRequest } from "./contract"
import { clip, decide, log, readInput, type Answer, type Question } from "./lib"

// The request and, when present, the assistant message it answers: a reply such as "go" or
// "fix all" carries its whole scope in that message, and Jev reads instructions literally.
const SUBJECT = "`request` (with `previous_reply`, the assistant message it answers, when present)"

const QUESTIONS: Record<string, Question & { type: "choice" }> = {
  effort: {
    type: "choice",
    instructions: `How much reasoning effort does the next step of ${SUBJECT} need to be done well?`,
    criteria: {
      low: "Trivial or mechanical: a lookup, a one-line edit, a rename, formatting, a quick factual or shell question.",
      medium: "Routine: a small fix or feature in one or two files, one test, a straightforward explanation or command.",
      high: "Substantial: changes across several files, debugging with an unclear cause, a code review, careful reasoning.",
      xhigh: "Hard: architecture, a subtle security or concurrency bug, a production incident, a long multi-step plan.",
    },
  },
  // The session's model, picked once. No haiku: one cheap opening request would hold every later
  // turn of the session on it, and a session usually grows past its first request.
  tier: {
    type: "choice",
    instructions: `Which model should run a coding session that starts with ${SUBJECT}?`,
    criteria: {
      sonnet: "Typical coding: features in a few files, tests, refactors, routine debugging, questions.",
      opus: "Hard debugging, architecture, multi-service changes, security or production-critical work.",
    },
  },
  // A subagent's model: it runs one task in a fresh context, so the cheap tier is safe here.
  agent: {
    type: "choice",
    instructions: "Which model should run the subagent task in `request`?",
    criteria: {
      haiku: "Mechanical: searching or listing files, reading and summarizing, simple lookups.",
      sonnet: "Typical work: implementing or reviewing code in a few files, focused research.",
      opus: "Hard: architecture, subtle debugging, security review, multi-step planning.",
    },
  },
}

// Below this, the session keeps what it would have done without Jev.
const ACT_AT = 0.7

// The questions worth asking Jev about `text`; none for an empty prompt or a slash command.
export function questionsFor(text: string, want: string[]): string[] {
  if (!text || text.startsWith("/")) return []
  // A greeting or a bare "go" says nothing about the session it opens; leave the pick to the
  // next prompt (measured: "hi" came back sonnet at confidence 1).
  const words = text.split(/\s+/).length
  return want.filter((k) => Object.hasOwn(QUESTIONS, k) && !(k === "tier" && words < 3))
}

// Only a choice this file defines, at ACT_AT or above, may pass: it becomes a model or effort the
// session runs on.
export function applied(answers: Record<string, Answer> | undefined, asked: string[]): Decision {
  // decide() logs the reason; the mod only needs to tell a failure from an unsure answer.
  if (!answers) return { failed: "no response from Jev (reason in ~/.cache/claude-jev/decisions.log)" }
  const out: Record<string, string> = {}
  for (const k of asked) {
    const choice = answers[k]?.choice
    if (choice !== undefined && Object.hasOwn(QUESTIONS[k].criteria, choice) && (answers[k]?.confidence ?? 0) >= ACT_AT)
      out[k] = choice
  }
  return out as Decision
}

async function main() {
  if (process.env.JEV_DISABLE === "1") return console.log("{}")
  const { prompt = "", previous, want = [] } = await readInput<Partial<TurnRequest>>()
  const text = prompt.trim()
  const asked = questionsFor(text, want)
  if (!asked.length) return console.log("{}")
  const answers = await decide(
    { request: clip(text, 8_000), ...(previous?.trim() ? { previous_reply: clip(previous, 3_000) } : {}) },
    Object.fromEntries(asked.map((k) => [k, QUESTIONS[k]])),
    TURN_BUDGET_MS,
  )
  const out = applied(answers, asked)
  const seen = Object.fromEntries(
    asked.map((k) => {
      const a = answers?.[k]
      return [k, a?.choice === undefined ? undefined : { choice: a.choice, conf: a.confidence ?? 0 }]
    }),
  )
  log("turn", { ...seen, applied: out, words: text.split(/\s+/).length })
  console.log(JSON.stringify(out))
}

if (import.meta.main)
  main().catch((e) => {
    log("crash", { hook: "turn", error: String(e) })
    console.log(JSON.stringify({ failed: String(e) }))
  })
