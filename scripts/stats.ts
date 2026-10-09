// /jev-stats: summarize ~/.cache/claude-jev/decisions.log, so the bars can be retuned from data.
// Run by the jev-route module as a subprocess; prints the report on stdout.

import { readFileSync } from "node:fs"
import { LOG_FILE } from "./lib"

type Entry = Record<string, any> & { ts: string; feature: string }

const METRICS: [feature: string, field: string][] = [
  ["permission", "safe"],
  ["permission", "destructive"],
  ["permission", "serves_task"],
  ["permission", "read_only"],
  ["permission", "risky"],
  ["injection", "p"],
  ["done_check", "p_claim"],
  ["done_check", "p_unfinished"],
  ["prompt", "vague"],
  ["prompt", "large"],
]

const BUCKETS: [label: string, test: (p: number) => boolean][] = [
  [">=0.9", (p) => p >= 0.9],
  ["0.8-0.9", (p) => p >= 0.8 && p < 0.9],
  ["0.5-0.8", (p) => p >= 0.5 && p < 0.8],
  ["<0.5", (p) => p < 0.5],
]

function count<T>(items: T[], key: (item: T) => string | undefined) {
  const out = new Map<string, number>()
  for (const item of items) {
    const k = key(item)
    if (k !== undefined) out.set(k, (out.get(k) ?? 0) + 1)
  }
  return [...out].sort((a, b) => b[1] - a[1])
}

const show = (rows: [string, number][]) => rows.map(([k, n]) => `${k} ${n}`).join(", ") || "none"

export function summarize(lines: string[], sinceMs: number): string {
  const entries: Entry[] = []
  for (const line of lines) {
    try {
      const e = JSON.parse(line)
      if (typeof e?.feature === "string" && Date.parse(e.ts) >= sinceMs) entries.push(e)
    } catch {}
  }
  if (!entries.length) return "no log entries in this window"

  const out = [`${entries.length} entries since ${new Date(sinceMs).toISOString().slice(0, 10)}: ${show(count(entries, (e) => e.feature))}`]

  const permission = entries.filter((e) => e.feature === "permission")
  if (permission.length) {
    out.push(`permission results: ${show(count(permission, (e) => e.result))}`)
    out.push(`permission by tool: ${show(count(permission, (e) => (e.tool === "Bash" ? "Bash" : "other")))}`)
    out.push(`permission static-blocked: ${permission.filter((e) => e.static_block).length}`)
  }

  const turns = entries.filter((e) => e.feature === "turn")
  if (turns.length) {
    out.push(`turn effort asked: ${show(count(turns, (e) => e.effort?.choice))}`)
    out.push(`turn tier asked: ${show(count(turns, (e) => e.tier?.choice))}`)
    const answered = turns.filter((e) => !e.applied?.failed)
    out.push(`turn jev gave no answer: ${turns.length - answered.length}`)
    out.push(`turn applied: ${show(count(answered, (e) => Object.keys(e.applied ?? {}).join("+") || "nothing"))}`)
  }

  out.push("", "probability buckets (the bars sit at 0.8-0.9: the middle two buckets are the near misses)")
  for (const [feature, field] of METRICS) {
    const values = entries.filter((e) => e.feature === feature && typeof e[field] === "number").map((e) => e[field] as number)
    if (values.length) out.push(`${feature}.${field} n=${values.length}: ${BUCKETS.map(([label, test]) => `${label} ${values.filter(test).length}`).join(", ")}`)
  }

  const errors = entries.filter((e) => e.feature === "error" || e.feature === "crash")
  out.push("", `failures: ${errors.length}`)
  if (errors.length) out.push(show(count(errors, (e) => String(e.error).slice(0, 80)).slice(0, 5)))

  const ms = permission.map((e) => e.ms).filter((n) => typeof n === "number").sort((a, b) => a - b)
  if (ms.length) out.push(`permission latency ms: median ${ms[Math.floor(ms.length / 2)]}, p95 ${ms[Math.min(ms.length - 1, Math.floor(ms.length * 0.95))]}`)
  return out.join("\n")
}

function main() {
  const days = Number(process.argv[2] || 7)
  const sinceMs = Date.now() - (Number.isFinite(days) && days > 0 ? days : 7) * 86_400_000
  const lines = [LOG_FILE + ".1", LOG_FILE].flatMap((f) => {
    try {
      return readFileSync(f, "utf8").split("\n")
    } catch {
      return []
    }
  })
  console.log(summarize(lines, sinceMs))
}

if (import.meta.main) main()
