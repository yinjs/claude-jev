import { expect, test } from "bun:test"
import { provider } from "./lib"

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
