# jev

A Claude Code plugin that hands Claude Code's small, frequent decisions to [Jev](https://docs.typesafe.ai/concepts/system-one),
TypeSafe's decision model: Jev reads a short state and answers typed questions (yes/no with a
probability, or a choice with a confidence) in about a second, for a fraction of a cent. You get
fewer permission prompts, a warning when fetched content addresses the agent, a second look at
"done", and effort and model routing.

It asks at six points: four event hooks and two routing decisions. Each makes one ~1 s call and
changes nothing when Jev is unsure or unreachable.

| Script | Runs on | Does |
|---|---|---|
| `permission.ts` | PermissionRequest (Bash, WebFetch, MCP) | Bash: allow at >=0.9 safe, <=0.1 destructive, >=0.9 on-task; deny at >=0.9 destructive; a static list (rm -rf, push, sudo, deploys, secrets, pipe-to-shell, file uploads, `find -delete`, `npx`-style fetch-and-run) is never auto-approved. WebFetch/MCP: allow clear read-only calls (on-task too, for WebFetch); never deny — an MCP request carries no statement of what the user asked for, so there is no off-task signal to deny on. |
| `injection.ts` | PostToolUse (WebFetch, WebSearch, MCP except codegraph, and Bash commands that download: `curl`, `wget`, `gh api`, …) | At >=0.8, tells Claude and the auto-mode classifier that the result contains text addressed to an agent. |
| `done-check.ts` | Stop | After edits in a turn: continues once if the answer claims checks pass with no check run after the last edit, or reads as done while leaving stubs. |
| `prompt-nudge.ts` | UserPromptSubmit | Large/risky requests: plan first. Vague ones (>=0.9): ask first. Skips slash commands and replies under 3 words. |
| `turn.ts` | the jev-route module (below) | Effort per turn, the session's model, and a subagent's model. Owns the questions and the 0.7 confidence bar. |

Deny rules in settings still win over the permission hook.

## Limits

Read these before letting the permission hook approve commands for you.

- The static never-approve list is a backstop, not a sandbox. Anything it does not match, such as
  `python3 -c "…"`, is allowed on Jev's judgment alone.
- The bars (0.9 to approve, 0.8 to warn of injection) were tuned against live Jev.
  They are not a guarantee; a command Jev misjudges is run without asking.
- The injection warning is advice to Claude, never a block, and only the head and tail of a long
  result (12k characters) are examined.
- jev-route pins `claude-{sonnet,opus}-5-5`. When newer models ship, set
  `ANTHROPIC_DEFAULT_{SONNET,OPUS}_MODEL` or wait for a release that bumps the ids.

Use it at your own risk (see [LICENSE](LICENSE)). Report a security problem through a
[private advisory](https://github.com/yinjs/claude-jev/security/advisories/new), not a public issue.

## Requirements

- Claude Code v2.1.287 or later (the jev-route module is a mod; the event hooks work on any version
  that loads plugin hooks).
- [Bun](https://bun.sh) on `PATH`; without bun every hook silently changes nothing.
- An API key for one of the providers below.

## Install

1. Install from the `yinjs` marketplace:

   ```sh
   claude plugin marketplace add yinjs/claude-jev
   claude plugin install jev@yinjs
   ```

2. Export the key in your shell rc file, e.g. `export OPENROUTER_API_KEY=sk-or-…`.

That is all for OpenRouter. For another provider, also set `JEV_PROVIDER` (below).

The key sits in the environment, which Claude's Bash tool inherits. The permission hook never
auto-approves a command that prints it (`printenv`, `env`, `echo $…_API_KEY`), but Claude Code may
run some of those without asking. To close that, add to `~/.claude/settings.json`:

```json
{ "permissions": { "deny": ["Bash(printenv:*)", "Bash(env)"] } }
```

## Provider

`JEV_PROVIDER` picks where Jev is called. All three take the same request and return the same
answers; only the URL, the key and the model id differ.

| `JEV_PROVIDER` | Endpoint | Default `JEV_MODEL` | Key variable |
|---|---|---|---|
| `openrouter` (default) | `https://openrouter.ai/api/alpha/decisions` | `typesafe/jev-1.13` | `OPENROUTER_API_KEY` |
| `typesafe` | `https://api.typesafe.ai/v1/systemone` | `jev-1.13.0` | `TYPESAFE_API_KEY` |
| `vercel` (AI Gateway) | `https://ai-gateway.vercel.sh/typesafe/v1/systemone` | `typesafe-ai/jev` | `AI_GATEWAY_API_KEY` |

`JEV_API_KEY`, when set, is used instead of the provider's key variable. An unknown `JEV_PROVIDER`,
or no key, makes every hook change nothing and logs why. Portkey also proxies Jev, but only with
your own TypeSafe key, so use `typesafe` directly.

## Cost

Jev 1.13 on OpenRouter costs $0.042 per million input tokens, with no charge for output (as listed
in October 2026). The largest request these hooks send is about 3k tokens, so a call costs at most
about $0.0002, and a day of heavy use, a few hundred calls, costs a few cents.

## Configuration

| Variable | Default | Effect |
|---|---|---|
| `JEV_DISABLE=1` | unset | Every hook and the routing module change nothing. |
| `JEV_PROVIDER` | `openrouter` | Where Jev is called (see Provider). |
| `JEV_MODEL` | per provider | The model id sent. |
| `JEV_API_KEY` | unset | The key, for any provider. |
| `JEV_APPROVE_AT` / `JEV_DENY_AT` | `0.9` | The permission hook's allow and deny bars. |
| `ANTHROPIC_DEFAULT_{SONNET,OPUS}_MODEL` | `claude-{sonnet,opus}-5-5` | The ids the session model is pinned to. |

Log: `~/.cache/claude-jev/decisions.log`, rotated to `.1` past 1 MiB, long fields clipped to 500
chars. It records the Bash commands the permission hook judged, so it is 0600 in a 0700 directory.

## What leaves the machine

Every Bash command and WebFetch/MCP input that reaches a permission prompt, every
WebFetch/WebSearch/MCP result, and Bash output from a command that downloads, over 200 characters (clipped to 12k), each prompt with the assistant
reply it answers (clipped to 3k, for jev-route), each general-purpose subagent's task, and each final
answer from a turn that edited files — all to the configured provider. codegraph is excluded from the injection
matcher by a negative lookahead: it returns the machine's own source, it is the highest-volume MCP
server, and it is the least likely to carry a third-party injection.

## jev-route: effort and model routing

A settings hook cannot change the model: its outputs allow, deny, or add context. A mod can rewrite
each request to the model (`turn.step`) and each subagent spawn (`agent.spawn`). `hooks/register.ts`
uses that, through `scripts/turn.ts`, under one constraint: **each model has its own prompt cache, and
switching re-reads the whole conversation uncached** (prompt-caching docs). Per-turn model routing
would pay that on every switch, so the module never does it. It routes only where the cache costs
nothing:

| What | When | Why it is cache-free |
|---|---|---|
| effort (low…xhigh) | every main-conversation turn | measured on claude-opus-5-5: effort low → xhigh → low kept the cache (54k read per turn). The docs also name Sonnet 5.5 and Fable 5.1, but a pinned claude-sonnet-5-5 re-wrote 42k on one effort change, so only Opus 5.5 is routed; add a model only after the same three-turn measurement |
| session model (sonnet or opus) | first prompt of 3+ words while the conversation is ≤8 messages, then held for every request | nothing much is cached yet; never haiku, which one cheap opener would impose on the whole session |
| subagent model (haiku/sonnet/opus) | `general-purpose` agents with no model chosen | a subagent starts with an empty context; a named agent's or Claude's own model choice is kept |

`/model` (or a fallback model) releases the pin for the rest of the session. `/jev-route` shows the
last turn's routing and what Jev said: its answer, `gave no answer` (unsure), `failed: …`, or
`not asked` (pinned to a model whose effort is not routed, so the call is skipped).
`/jev-route off|on` toggles it until the session ends (`/clear` ends it too).
`turn.step` needs a model id — the alias `sonnet` came back `unrecognized_model` and the session's
own model answered — so the module pins `claude-{sonnet,opus}-5-5`, or what
`ANTHROPIC_DEFAULT_{SONNET,OPUS}_MODEL` names. Bump those ids when the aliases move.

## Development

How to test and change the plugin is in [CLAUDE.md](CLAUDE.md), which Claude Code loads too.
`tsconfig.json` extends types Claude Code writes when it loads the plugin, so a fresh clone shows
type errors until the plugin has loaded once (`claude --plugin-dir .`).

Nothing upstream owns this integration: TypeSafe's own "Jev with coding agents" page says Jev is not
a coding-agent model. TypeSafe documents its API at docs.typesafe.ai/api; OpenRouter's
`alpha/decisions` endpoint is, as its path says, alpha and can change.

## License

MIT — see [LICENSE](LICENSE).
