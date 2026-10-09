// Shared Jev (TypeSafe's decision model) helpers for Claude Code hooks.
// Every function resolves to undefined on any failure so hooks can "change nothing".

import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

// Every provider takes TypeSafe's request and returns its answers; only the URL, the key and the
// model id differ.
export const PROVIDERS = {
  openrouter: { url: "https://openrouter.ai/api/alpha/decisions", model: "typesafe/jev-1.13", keyEnv: "OPENROUTER_API_KEY" },
  typesafe: { url: "https://api.typesafe.ai/v1/systemone", model: "jev-1.13.0", keyEnv: "TYPESAFE_API_KEY" },
  vercel: { url: "https://ai-gateway.vercel.sh/typesafe/v1/systemone", model: "typesafe-ai/jev", keyEnv: "AI_GATEWAY_API_KEY" },
} as const

export type ProviderName = keyof typeof PROVIDERS

export function provider(env: Record<string, string | undefined>) {
  const name = (env.JEV_PROVIDER || "openrouter") as ProviderName
  if (!Object.hasOwn(PROVIDERS, name)) return undefined
  const p = PROVIDERS[name]
  return { name, url: p.url, model: env.JEV_MODEL || p.model, key: env.JEV_API_KEY || env[p.keyEnv] }
}

const PROVIDER = provider(process.env)
const LOG_DIR = join(homedir(), ".cache", "claude-jev")
export const LOG_FILE = join(LOG_DIR, "decisions.log")
const LOG_MAX_BYTES = 1 << 20

export type Question =
  | { type: "noul"; instructions: string; criteria?: { true?: string; false?: string } }
  | { type: "score"; instructions: string; criteria: string[] }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }

export type Answer = { noul?: number; score?: number; choice?: string; confidence?: number }

export function log(feature: string, entry: Record<string, unknown>) {
  try {
    mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 })
    // Clip fields rather than the serialized line, so every line stays parseable JSON.
    const fields = Object.fromEntries(
      Object.entries(entry).map(([k, v]) => [k, typeof v === "string" && v.length > 500 ? v.slice(0, 500) + "…" : v]),
    )
    try {
      if (statSync(LOG_FILE).size > LOG_MAX_BYTES) renameSync(LOG_FILE, LOG_FILE + ".1")
    } catch {}
    appendFileSync(LOG_FILE, JSON.stringify({ ts: new Date().toISOString(), feature, ...fields }) + "\n", { mode: 0o600 })
  } catch {}
}

export function clip(value: unknown, limit = 60_000): string {
  const s = typeof value === "string" ? value : JSON.stringify(value)
  if (s.length <= limit) return s
  const half = Math.floor(limit / 2)
  return s.slice(0, half) + "\n…[truncated]…\n" + s.slice(-half)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// A live call takes about 1 s; a retry with less budget left than this would only time out.
const MIN_ATTEMPT_MS = 1_000

// Backoff before retrying a 429/529, which the API reference names as transient and says to
// retry after backing off. Undefined when honoring the server's retry-after would leave too
// little budget for the retry: calling earlier than the server asked is not backing off.
function backoffMs(res: Response, deadline: number): number | undefined {
  const header = res.headers.get("retry-after") ?? ""
  const seconds = Number(header)
  const asked = header && Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now()
  const wait = Number.isFinite(asked) && asked > 0 ? asked : 300
  return deadline - performance.now() - wait >= MIN_ATTEMPT_MS ? wait : undefined
}

// `via` is where the call goes; tests pass a provider and a fetch in place of the real ones.
export async function decide(
  state: Record<string, unknown>,
  questions: Record<string, Question>,
  timeoutMs: number,
  via: { provider?: ReturnType<typeof provider>; fetch?: typeof fetch } = { provider: PROVIDER, fetch },
): Promise<Record<string, Answer> | undefined> {
  const { provider: target, fetch: send = fetch } = via
  if (!target) {
    log("error", { error: `unknown JEV_PROVIDER ${process.env.JEV_PROVIDER}` })
    return undefined
  }
  const key = target.key
  if (!key) {
    log("error", { error: "no API key" })
    return undefined
  }
  const body = JSON.stringify({ model: target.model, state, questions })
  // timeoutMs covers every attempt and the backoff between them, so a retry cannot push a
  // hook past its timeout in hooks/hooks.json.
  const t0 = performance.now()
  const deadline = t0 + timeoutMs
  const fail = (error: string) => {
    log("error", { error, ms: Math.round(performance.now() - t0) })
    return undefined
  }
  for (const attempt of [1, 2]) {
    const left = deadline - performance.now()
    if (left <= 0) break
    let res: Response
    try {
      res = await send(target.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "Claude Code Jev hooks" },
        body,
        signal: AbortSignal.timeout(left),
      })
    } catch (e) {
      // One retry for a dropped connection, never after a timeout.
      const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")
      if (attempt === 1 && !timedOut && deadline - performance.now() >= MIN_ATTEMPT_MS) continue
      return fail(String(e))
    }
    if (!res.ok) {
      const wait = attempt === 1 && (res.status === 429 || res.status === 529) ? backoffMs(res, deadline) : undefined
      if (wait === undefined) return fail(`HTTP ${res.status}`)
      await sleep(wait)
      continue
    }
    let data: { answers?: Record<string, Answer> }
    try {
      data = (await res.json()) as typeof data
    } catch (e) {
      return fail(`unparseable body: ${e}`)
    }
    if (!data.answers || !Object.keys(questions).every((k) => k in data.answers!)) return fail("bad shape")
    return data.answers
  }
  return fail("budget exhausted")
}

export function noul(a: Record<string, Answer> | undefined, k: string): number | undefined {
  const v = a?.[k]?.noul
  return typeof v === "number" && v >= 0 && v <= 1 ? v : undefined
}

export async function readInput<T>(): Promise<T> {
  const { text } = await import("node:stream/consumers")
  return JSON.parse(await text(process.stdin)) as T
}

export function emit(obj: unknown) {
  console.log(JSON.stringify(obj))
}
