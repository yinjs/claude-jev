# jev plugin — development notes

User-facing docs are in README.md. This file holds what you would get wrong working on the code.

The author keeps the same Jev integration for pi and Hermes in private repos (`yinjs/pi-jev`,
`yinjs/hermes-jev`). A change to a question's wording, a threshold, or what gets scanned belongs in
those too, or the agents drift.

## Test

- `bun test scripts/` runs the hook scripts' tests; `claude plugin test` runs `tests/*.test.ts` against
  the jev-route module with no session or network. Run both.
- Bun tests are named `*.spec.ts`, never `*.test.ts`: `claude plugin test` loads every `*.test.ts` and
  fails on any that imports `bun:test`.
- `claude plugin validate .` lists the module's hooks and calls, not the event hooks in `hooks/hooks.json`.
- Live check without spending a turn: `claude -p /jev-route`. With one, `claude -p … --output-format json`
  reports the model that actually answered under `modelUsage`.

## Release

- Bump `version` in `.claude-plugin/plugin.json` with every change users should get: installed copies
  are cached by version, so an unbumped change never reaches them. Tag the commit `v<version>`.

## Hooks

- Every failure changes nothing: print nothing, exit 0, log to `~/.cache/claude-jev/decisions.log`.
  Any stdout a hook prints is acted on.
- Output fields differ per event. A Stop hook continues the turn only with `{decision: "block", reason}`;
  `additionalContext` on Stop is shown as feedback and Claude stops anyway. Check the hooks reference
  for any new event before emitting.
- Write `additionalContext` as facts ("Jev rates this p=…"), not commands: context framed as
  out-of-band instructions trips Claude's injection defenses and is surfaced instead of used.
- Each script's `BUDGET_MS` + 1 s must fit under its `timeout` in `hooks/hooks.json`; a hook Claude Code
  kills loses its decision. `scripts/budget.spec.ts` checks this.
- Jev thresholds were tuned against live Jev. Read jev-1.13's published jaggedness notes before
  retuning: context rot (mode 5) is why every hook clips what it sends, and "state is not treated as
  hostile" is why the injection verdict is a warning, never a guarantee.

## jev-route module (`hooks/register.ts`)

- A module may load only its own files and `claude-code`, so it cannot import `scripts/lib.ts`. It runs
  `scripts/turn.ts` as a subprocess; `scripts/contract.ts` is their stdin/stdout contract and imports nothing.
- `.claude-plugin/types/` is written on each load for the running Claude Code version and is
  gitignored, so a fresh clone has no types until the plugin loads. Trust it over the docs.
- `turn.step` needs a model id, not an alias: `sonnet` returns `unrecognized_model`.
- Add a model to `CACHE_SAFE_EFFORT` only after measuring it: three turns in one session with effort
  varying, `cacheReadInputTokens` per turn from `--output-format stream-json`.
