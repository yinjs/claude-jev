// The stdin/stdout contract between scripts/turn.ts and the jev-route module (hooks/register.ts).
// Kept free of imports: the module may load only its own files and "claude-code".

// turn.ts's whole Jev call; the module allows TURN_BUDGET_MS plus bun startup and key retrieval.
export const TURN_BUDGET_MS = 6_000

export type Want = 'effort' | 'tier' | 'agent'

export type TurnRequest = { prompt: string; previous?: string; want: Want[] }

// `failed` says why Jev returned nothing, when the call failed rather than answered unsure.
export type Decision = {
  effort?: 'low' | 'medium' | 'high' | 'xhigh'
  tier?: 'sonnet' | 'opus'
  agent?: 'haiku' | 'sonnet' | 'opus'
  failed?: string
}
