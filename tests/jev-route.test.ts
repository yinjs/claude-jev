import { expect, test } from 'claude-code/testing'

// Stubs every call the module makes; `jev` is what turn.ts would print, `rows` the transcript.
function stubs(on: any, jev: Record<string, string> | 'fail', rows: unknown[] = [], seen: { stdin?: string[]; steps?: any[]; spawns?: any[] } = {}) {
  on('session.messages', () => ({ value: rows }))
  on('ui.log', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('process.run', ($: any, e: any) => {
    ;(seen.stdin ??= []).push(e.init?.stdin ?? '')
    if (jev === 'fail') return { deny: 'bun missing' }
    return { value: { exitCode: 0, stdout: JSON.stringify(jev), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('session.end', ($: any, e: any) => ({ sessionId: e.sessionId }))
  on('turn.step', async function* ($: any, e: any) {
    ;(seen.steps ??= []).push(e)
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('agent.spawn', ($: any, e: any) => {
    ;(seen.spawns ??= []).push(e)
    return { model: e.model ?? e.parentModel, agentId: 'a1' }
  })
  return seen
}

async function step($: any, e: Record<string, unknown>) {
  const stream = $.turn.step({ index: 0, messageCount: 1, ...e })
  let s = await stream.next()
  while (s.done !== true) s = await stream.next()
  return s.value
}

const OPUS = 'claude-opus-5-5'

test('lowers effort on a cache-safe model', async ($, on) => {
  const seen = stubs(on, { effort: 'low' })
  await $.turn.start({ turnId: 't1', text: 'what does git stash pop do' })
  await step($, { turnId: 't1', model: OPUS, effort: 'high' })
  expect(seen.steps![0].effort).toBe('low')
  expect(seen.steps![0].model).toBe(OPUS)
})

test('leaves effort alone where a change would rebuild the cache', async ($, on) => {
  const seen = stubs(on, { effort: 'low' })
  await $.turn.start({ turnId: 't1', text: 'what does git stash pop do' })
  await step($, { turnId: 't1', model: 'claude-haiku-4-5', effort: 'high' })
  expect(seen.steps![0].effort).toBe('high')
})

test('/jev-route says whether Jev answered, even when nothing changed', async ($, on) => {
  stubs(on, {})
  await $.turn.start({ turnId: 't1', text: 'add a unit test for parseDate' })
  await step($, { turnId: 't1', model: OPUS, effort: 'high' })
  expect((await $.command.run({ command: 'jev-route', args: '' } as any)).text).toBe(
    'session effort kept · jev gave no answer',
  )
})

test('/jev-route names a failed Jev call', async ($, on) => {
  stubs(on, 'fail')
  await $.turn.start({ turnId: 't1', text: 'add a unit test for parseDate' })
  await step($, { turnId: 't1', model: OPUS, effort: 'high' })
  expect((await $.command.run({ command: 'jev-route', args: '' } as any)).text).toMatch(/jev failed: .*bun missing/)
})

test('/jev-route names a failure turn.ts reports, and changes nothing', async ($, on) => {
  const seen = stubs(on, { failed: 'no response from Jev' })
  await $.turn.start({ turnId: 't1', text: 'add a unit test for parseDate' })
  await step($, { turnId: 't1', model: OPUS, effort: 'high' })
  expect(seen.steps![0]).toMatchObject({ model: OPUS, effort: 'high' })
  expect((await $.command.run({ command: 'jev-route', args: '' } as any)).text).toBe(
    'session effort kept · jev failed: no response from Jev',
  )
})

test('asks only about effort, with the last assistant message as context', async ($, on) => {
  const rows = [{ role: 'user', text: 'q', toolUses: [] }, { role: 'assistant', text: 'a', toolUses: [] }]
  const seen = stubs(on, {}, rows)
  await $.turn.start({ turnId: 't1', text: 'continue with the refactor' })
  await step($, { turnId: 't1', model: OPUS, effort: 'high' })
  expect(JSON.parse(seen.stdin![0]!)).toMatchObject({ want: ['effort'], previous: 'a' })
})

test('a subagent loop is never rerouted', async ($, on) => {
  const seen = stubs(on, { effort: 'low' })
  await $.turn.start({ turnId: 't1', text: 'find all lodash imports' })
  await step($, { turnId: 't1', model: OPUS, effort: 'high', agentId: 'a1' })
  expect(seen.steps![0]).toMatchObject({ model: OPUS, effort: 'high' })
})

test('a Jev failure changes nothing', async ($, on) => {
  const seen = stubs(on, 'fail')
  await $.turn.start({ turnId: 't1', text: 'add a unit test for parseDate' })
  await step($, { turnId: 't1', model: OPUS, effort: 'high' })
  expect(seen.steps![0]).toMatchObject({ model: OPUS, effort: 'high' })
})

test('/jev-route off stops routing for the session', async ($, on) => {
  const seen = stubs(on, { effort: 'low' })
  const reply = await $.command.run({ command: 'jev-route', args: 'off' } as any)
  expect(reply.text).toMatch(/^off/)
  await $.turn.start({ turnId: 't1', text: 'add a unit test for parseDate' })
  await step($, { turnId: 't1', model: OPUS, effort: 'high' })
  expect(seen.steps![0]).toMatchObject({ model: OPUS, effort: 'high' })
  expect(seen.stdin ?? []).toEqual([])
})

test('/clear ends /jev-route off and the last report with the session', async ($, on) => {
  const seen = stubs(on, { effort: 'low' })
  await $.command.run({ command: 'jev-route', args: 'off' } as any)
  await $.session.end({ sessionId: 's1', reason: 'clear' } as any)
  expect((await $.command.run({ command: 'jev-route', args: '' } as any)).text).toBe('no turn yet this session')
  await $.turn.start({ turnId: 't1', text: 'what does git stash pop do' })
  await step($, { turnId: 't1', model: OPUS, effort: 'high' })
  expect(seen.steps![0].effort).toBe('low')
})

const SPAWN = { tool_use_id: 'tu1', prompt: 'List files importing lodash', description: 'find imports', parentModel: OPUS,
  provider: { plugin: 'engine', tier: 'core' }, fork: false, background: false }

test('routes a general-purpose subagent with no chosen model', async ($, on) => {
  const seen = stubs(on, { agent: 'haiku' })
  await $.agent.spawn({ ...SPAWN, subagentType: 'general-purpose' } as any)
  expect(seen.spawns![0].model).toBe('haiku')
  expect(JSON.parse(seen.stdin![0]!).want).toEqual(['agent'])
})

test('leaves a named agent, an explicit model and a fork alone', async ($, on) => {
  const seen = stubs(on, { agent: 'haiku' })
  await $.agent.spawn({ ...SPAWN, subagentType: 'Explore' } as any)
  await $.agent.spawn({ ...SPAWN, subagentType: 'general-purpose', model: 'opus' } as any)
  await $.agent.spawn({ ...SPAWN, subagentType: 'general-purpose', fork: true } as any)
  expect(seen.spawns!.map((s: any) => s.model)).toEqual([undefined, 'opus', undefined])
  expect(seen.stdin ?? []).toEqual([])
})
