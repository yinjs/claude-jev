// jev-route: Jev picks the effort of each main-conversation turn, the model of a session, and the
// model of a general-purpose subagent. Each choice is made where it costs no prompt-cache rebuild,
// because every model keeps its own cache and a switch re-reads the whole conversation uncached:
//   - effort, per turn, only on models whose cache survives an effort change (CACHE_SAFE_EFFORT);
//   - the session's model, once, while the conversation is still short, then held for every step;
//   - a subagent's model at spawn, when its context is empty anyway.
// The questions and thresholds live in ../scripts/turn.ts; this module applies them.

import type { EngineInterface, On } from 'claude-code'
import { TURN_BUDGET_MS, type Decision, type TurnRequest } from '../scripts/contract'

// Effort is routed only on models measured to keep the cache across an effort change. The
// prompt-caching docs also list Sonnet 5.5 and Fable 5.1, but a pinned claude-sonnet-5-5 session
// re-wrote its whole cache (42k tokens) on a low -> xhigh change while claude-opus-5-5 read its 54k
// back through low -> xhigh -> low. Add a model here only after the same measurement: three turns in
// one session, effort varying, cacheReadInputTokens per turn from --output-format stream-json.
const CACHE_SAFE_EFFORT = /opus-5-5/

// turn.step takes a model id, not an alias: "sonnet" came back unrecognized_model and the session's
// own model answered. These are what the aliases resolve to on the Anthropic API for this Claude Code
// version, and ANTHROPIC_DEFAULT_{SONNET,OPUS}_MODEL override them here as they override the aliases.
const MODEL_IDS: Record<string, string> = { sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5' }

// The session model is picked only while the conversation holds at most this many messages, so the
// rebuild a pick causes stays small.
const PIN_WHILE_MESSAGES = 8

// Per-session state; resetSession() is the one place that sets its starting values.
const pending = new Map<string, Promise<Decision>>()
let pin: { model: string; base: string } | undefined
let pinSettled!: boolean
let off!: boolean
let routed!: string
let last!: string

async function judge($: EngineInterface, request: TurnRequest): Promise<Decision> {
  try {
    const r = await $.process.run(['bun', $.plugin.root + '/scripts/turn.ts'], {
      stdin: JSON.stringify(request),
      timeoutMs: TURN_BUDGET_MS + 2000,
    })
    return r.exitCode === 0 ? JSON.parse(r.stdout.trim() || '{}') : { failed: 'turn.ts exited ' + r.exitCode }
  } catch (err) {
    return { failed: String(err) }
  }
}

function resetSession() {
  pending.clear()
  pin = undefined
  pinSettled = false
  off = false
  routed = ''
  last = 'no turn yet this session'
}
resetSession()

async function modelId($: EngineInterface, tier: string): Promise<string | undefined> {
  const override =
    tier === 'opus' ? await $.env.get('ANTHROPIC_DEFAULT_OPUS_MODEL') : await $.env.get('ANTHROPIC_DEFAULT_SONNET_MODEL')
  return override || MODEL_IDS[tier]
}

export function register(on: On) {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'jev-route',
      description: 'Show what jev-route last decided; /jev-route off or on toggles it for this session',
    })
    return next(e)
  })

  // /clear and /resume start another conversation: a new pick is free after /clear, and a resumed
  // one is past PIN_WHILE_MESSAGES by the time it is long enough to matter.
  on('session.end', async ($, e, next) => {
    resetSession()
    return next(e)
  })

  on('command.run', { command: 'jev-route' }, async ($, e) => {
    const arg = (e.args ?? '').trim()
    if (arg === 'off' || arg === 'on') {
      off = arg === 'off'
      if (off) pin = undefined
      return { text: off ? 'off for this session; the session model is no longer pinned' : 'on for this session' }
    }
    return { text: (off ? '[off] ' : '') + last + (pin ? ' · pinned ' + pin.model : '') }
  })

  // Ask at the start of the turn without waiting: the answer is awaited at the turn's first request,
  // so the Jev call overlaps whatever Claude Code does in between.
  on('turn.start', async ($, e, next) => {
    if (!off && e.text.trim()) {
      const rows = await $.session.messages()
      const messages = Array.isArray(rows) ? rows : []
      if (messages.length > PIN_WHILE_MESSAGES) pinSettled = true
      const previous = messages.findLast((m) => m.role === 'assistant' && m.text.trim())
      // Effort is applied only on cache-safe models, so a pin onto another model has nothing left to ask.
      if (!(pin && !CACHE_SAFE_EFFORT.test(pin.model))) {
        pending.set(
          e.turnId,
          judge($, { prompt: e.text, previous: previous?.text, want: pinSettled ? ['effort'] : ['effort', 'tier'] }),
        )
      }
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    // A subagent's model is set at spawn, and its effort is left as Claude Code sets it.
    if (off || e.agentId !== undefined) return yield* next(e)
    const decision = (await pending.get(e.turnId)) ?? {}

    // A model other than the one pinned over means the user ran /model or a fallback took over:
    // theirs wins for the rest of the session.
    if (pin && e.model !== pin.base) {
      pin = undefined
      pinSettled = true
    }
    if (decision.tier && !pinSettled) {
      pinSettled = true
      const id = e.model.includes(decision.tier) ? undefined : await modelId($, decision.tier)
      if (id) pin = { model: id, base: e.model }
    }

    const model = pin ? pin.model : e.model
    const effort =
      decision.effort && e.effort !== undefined && CACHE_SAFE_EFFORT.test(model) ? decision.effort : e.effort
    const parts: string[] = []
    if (model !== e.model) parts.push('model ' + model + ' (session: ' + e.model + ')')
    if (effort !== e.effort) parts.push('effort ' + effort + ' (session: ' + e.effort + ')')
    const now = parts.join(' · ')
    // /jev-route reports every turn, so "Jev changed nothing" and "Jev gave no answer" stay distinguishable.
    const { failed, ...answer } = decision
    last =
      (now || 'session model and effort kept') +
      ' · jev ' +
      (!pending.has(e.turnId)
        ? 'not asked'
        : failed
          ? 'failed: ' + failed
          : Object.keys(answer).length
            ? JSON.stringify(answer)
            : 'gave no answer')
    if (!now) return yield* next(e)
    // One dim transcript line when the routing changes, not one per request.
    if (now !== routed) $.ui.log('jev-route: ' + now)
    routed = now
    return yield* next({ ...e, model, effort })
  })

  on('turn.complete', async ($, e, next) => {
    pending.delete(e.turnId)
    return next(e)
  })

  // Only the generic agent, and only when nothing chose its model: a named agent's frontmatter
  // model, or one Claude passed, was chosen on purpose. A fork shares the parent's context and model.
  on('agent.spawn', async ($, e, next) => {
    if (off || e.fork || e.model !== undefined || e.subagentType !== 'general-purpose') return next(e)
    const decision = await judge($, { prompt: e.prompt, want: ['agent'] })
    if (!decision.agent) return next(e)
    // Aliases resolve like the Agent tool's model parameter; log what core resolved, not what was asked.
    const r = await next({ ...e, model: decision.agent })
    if ('model' in r) $.ui.log('jev-route: subagent "' + e.description + '" on ' + r.model)
    return r
  }).catch(($, e, next) => next(e)) // routing never costs the spawn: before next, spawn as asked; after, next(e) replays that result
}
