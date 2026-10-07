import { expect, test } from "bun:test"
import { decide, provider } from "./lib"

test("defaults to OpenRouter and its key", () => {
  expect(provider({ OPENROUTER_API_KEY: "or" })).toEqual({
    name: "openrouter", url: "https://openrouter.ai/api/alpha/decisions", model: "typesafe/jev-1.13", key: "or",
  })
})

test("a provider brings its own URL, model id and key variable", () => {
  expect(provider({ JEV_PROVIDER: "typesafe", TYPESAFE_API_KEY: "ts", OPENROUTER_API_KEY: "or" })).toMatchObject({
    url: "https://api.typesafe.ai/v1/systemone", model: "jev-1.13.0", key: "ts",
  })
  expect(provider({ JEV_PROVIDER: "vercel" })).toMatchObject({ model: "typesafe-ai/jev", key: undefined })
})

test("JEV_API_KEY and JEV_MODEL override any provider's defaults", () => {
  expect(provider({ JEV_PROVIDER: "typesafe", JEV_API_KEY: "k", JEV_MODEL: "jev-latest" })).toMatchObject({ key: "k", model: "jev-latest" })
})

test("an unknown provider resolves to nothing, so every hook changes nothing", () => {
  expect(provider({ JEV_PROVIDER: "toString" })).toBeUndefined()
  expect(provider({ JEV_PROVIDER: "bogus" })).toBeUndefined()
})

const target = provider({ OPENROUTER_API_KEY: "k" })
const q = { ok: { type: "noul" as const, instructions: "x" } }
const answered = () => Response.json({ answers: { ok: { noul: 1 } } })

// Each reply is a Response, or an Error to throw as a dropped connection.
function replies(...rs: (Response | Error)[]) {
  const calls: RequestInit[] = []
  const send = (async (_url: string, init: RequestInit) => {
    calls.push(init)
    const r = rs.shift()!
    if (r instanceof Error) throw r
    return r
  }) as unknown as typeof fetch
  return { calls, send }
}

test("sends the model, state and questions with the provider's key", async () => {
  const { calls, send } = replies(answered())
  expect(await decide({ a: 1 }, q, 5_000, { provider: target, fetch: send })).toEqual({ ok: { noul: 1 } })
  expect(JSON.parse(calls[0].body as string)).toEqual({ model: "typesafe/jev-1.13", state: { a: 1 }, questions: q })
  expect((calls[0].headers as Record<string, string>).Authorization).toBe("Bearer k")
})

test("retries once after a 429 or a dropped connection", async () => {
  const busy = replies(new Response("", { status: 429 }), answered())
  expect(await decide({}, q, 5_000, { provider: target, fetch: busy.send })).toEqual({ ok: { noul: 1 } })
  const dropped = replies(new TypeError("socket closed"), answered())
  expect(await decide({}, q, 5_000, { provider: target, fetch: dropped.send })).toEqual({ ok: { noul: 1 } })
  expect([busy.calls.length, dropped.calls.length]).toEqual([2, 2])
})
