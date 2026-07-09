# CodingAgentDriver seam (miner hands)

Design note for [#4312](https://github.com/JSONbored/gittensory/issues/4312). Documents the settled `CodingAgentDriver` interface introduced in [#4262](https://github.com/JSONbored/gittensory/issues/4262) at `packages/gittensory-engine/src/miner/coding-agent-driver.ts`. This file is prose documentation — it is **not** checked by [`scripts/check-docs-drift.mjs`](../../../scripts/check-docs-drift.mjs) (that script only guards enumerable code-driven surfaces such as feature flags, `@gittensory` commands, and gate-mode dimensions). Keep it accurate by hand when the interface or surrounding primitives change.

Part of the Miner Wave 2 — Analyze, Plan, Create & Deploy batch ([#1058](https://github.com/JSONbored/gittensory/issues/1058) close-the-loop epic).

## What it is and why it exists

`CodingAgentDriver` is the foundational seam for Phase 3 (**Create + Iterate — the hands**). It lets the miner run **either** a CLI subprocess **or** the Agent SDK (or a future third backend) behind **one** interface, the same way the review stack runs Ollama, OpenAI-compatible HTTP, Claude Code, or Codex behind `SelfHostAi`.

| Concern | `SelfHostAi` (review stack) | `CodingAgentDriver` (miner hands) |
|---------|----------------------------|-----------------------------------|
| Interface | `run(model, options) → AiResult` | `run(task) → CodingAgentDriverResult` |
| Backends | HTTP providers + subscription CLIs | CLI subprocess ([#4266](https://github.com/JSONbored/gittensory/issues/4266)) + Agent SDK `query()` loop ([#4267](https://github.com/JSONbored/gittensory/issues/4267)) |
| Runtime selection | `AI_PROVIDER` string via [`src/selfhost/ai-config.ts`](../../../src/selfhost/ai-config.ts) | Provider-name factory ([#4289](https://github.com/JSONbored/gittensory/issues/4289)) |
| Testability | Injected `SpawnFn` on `createClaudeCodeAi` / `createCodexAi` | Injected spawn/clock/fs at driver construction (same convention) |

The interface deliberately performs **no** network calls, **no** GitHub writes, and **no** autonomous continue/stop decisions. Those belong to the maintainer-owned iterate-loop orchestrator ([#2333](https://github.com/JSONbored/gittensory/issues/2333)).

## Design rationale — mirror `SelfHostAi`, don't invent a new pattern

[`src/selfhost/ai.ts`](../../../src/selfhost/ai.ts) documents the precedent in its header comment: gittensory calls `env.AI.run(model, options)` and every backend returns `{ response }` (or throws). `CodingAgentDriver` copies that shape:

```typescript
export interface CodingAgentDriver {
  run(task: CodingAgentDriverTask): Promise<CodingAgentDriverResult>;
}
```

**Why mirror instead of a bespoke miner-only abstraction?**

1. **Proven provider fan-out** — `SelfHostAi` already fans out to four backends with identical call sites; the miner needs the same “one call site, many backends” property for coding agents.
2. **Familiar test hooks** — subscription CLIs inject `SpawnFn` rather than hardcoding `child_process` ([`createClaudeCodeAi`](../../../src/selfhost/ai.ts), [`createCodexAi`](../../../src/selfhost/ai.ts)). Driver implementations should inject the same kinds of dependencies.
3. **Factory symmetry** — `resolveConfiguredProviderNames` / `isConfiguredSelfHostProvider` in [`src/selfhost/ai-config.ts`](../../../src/selfhost/ai-config.ts) select a backend from a provider string; the miner factory ([#4289](https://github.com/JSONbored/gittensory/issues/4289)) follows that pattern for `CODING_AGENT_DRIVER` (exact env key lands with the factory issue).
4. **Engine purity boundary** — `@jsonbored/gittensory-engine` stays deterministic for scoring/gate logic; IO-heavy driver **implementations** live outside the interface file, but the **contract** lives in `packages/gittensory-engine/src/miner/` alongside other miner primitives ([#2333](https://github.com/JSONbored/gittensory/issues/2333) naming).

Task and result types are **provider-agnostic**: nothing in `CodingAgentDriverTask` / `CodingAgentDriverResult` assumes a subprocess CLI vs an SDK event loop. Provider-specific detail stays in `usage.provider` or the driver-local transcript, not in shared orchestration types.

## Interface contract (settled in #4262)

Source of truth: [`packages/gittensory-engine/src/miner/coding-agent-driver.ts`](../../gittensory-engine/src/miner/coding-agent-driver.ts).

### `CodingAgentDriverTask` (input)

| Field | Purpose |
|-------|---------|
| `workingDirectory` | Absolute path to the isolated tree for this attempt (prepared by worktree isolation, [#4269](https://github.com/JSONbored/gittensory/issues/4269)). |
| `acceptanceCriteriaPath` | Path to the immutable criteria file written **before** the agent starts ([#4271](https://github.com/JSONbored/gittensory/issues/4271)). |
| `instructions` | Goal text for this attempt (issue context, constraints, maintainer notes). |
| `turnBudgetCeiling` | Hard cap on turns/tool rounds; drivers enforce and report against it ([#4311](https://github.com/JSONbored/gittensory/issues/4311)). |

### `CodingAgentDriverResult` (output)

| Field | Purpose |
|-------|---------|
| `ok` | Whether the attempt produced an acceptable local outcome. |
| `changedFiles` | Repo-relative paths touched under `workingDirectory`. |
| `transcript` | Human-readable summary for logs/UI — not parsed for control flow. |
| `usage` | Turn count / duration / opaque `provider` blob for metering ([#4311](https://github.com/JSONbored/gittensory/issues/4311)). |
| `errorReason` | Stable machine reason when `ok` is false (e.g. `turn_budget_exceeded`). |

## Driver-authoring guide (adding a third backend)

Today’s planned implementations:

| Issue | Backend |
|-------|---------|
| [#4266](https://github.com/JSONbored/gittensory/issues/4266) | CLI subprocess — reuse `SpawnFn`, `redactSecrets`, `EFFORT_TIMEOUT_MS` patterns from `src/selfhost/ai.ts` |
| [#4267](https://github.com/JSONbored/gittensory/issues/4267) | Agent SDK — `query()` loop driver |

To add a **third** implementation (e.g. a remote sandbox API):

### 1. Implement `CodingAgentDriver`

```typescript
import type { CodingAgentDriver, CodingAgentDriverTask, CodingAgentDriverResult } from "@jsonbored/gittensory-engine";

export type MyDriverDeps = {
  spawn?: SpawnFn; // if subprocess-based — inject in tests
  fetchImpl?: typeof fetch; // if HTTP-based
};

export function createMyCodingAgentDriver(deps: MyDriverDeps = {}): CodingAgentDriver {
  return {
    async run(task: CodingAgentDriverTask): Promise<CodingAgentDriverResult> {
      // Read acceptanceCriteriaPath (#4271) — treat as read-only input.
      // Operate only inside task.workingDirectory (#4269).
      // Respect task.turnBudgetCeiling; populate usage.turnCount (#4311).
      // Emit JSONL attempt events via the attempt-log helper (#4294) from the orchestrator wrapper, not buried inside provider stderr.
      return { ok: true, changedFiles: [], transcript: "…", usage: { turnCount: 1 } };
    },
  };
}
```

**Rules:**

- Never mutate gate/review disposition — this seam is auto-review/coding only ([#1960](https://github.com/JSONbored/gittensory/issues/1960) command-surface constraint applies to PR commands; the driver itself never touches GitHub).
- Inject IO (`SpawnFn`, clocks, filesystem) — do not hardcode `child_process` or `Date.now()` if tests need control.
- Keep provider-specific fields out of `CodingAgentDriverTask` / shared result keys; use `usage.provider` for opaque telemetry.

### 2. Register with the factory ([#4289](https://github.com/JSONbored/gittensory/issues/4289))

Mirror `buildProvider()` in [`src/selfhost/ai.ts`](../../../src/selfhost/ai.ts):

- Add a provider name to config resolution (same style as `isConfiguredSelfHostProvider`).
- Export `createMyCodingAgentDriver` from the miner package implementation layer.
- Factory returns `CodingAgentDriver` — callers depend only on the interface.

### 3. Cover with the parity/contract suite ([#4296](https://github.com/JSONbored/gittensory/issues/4296))

- Extend `packages/gittensory-engine/test/coding-agent-driver.test.ts` only for **interface** contract tests (fake driver).
- Behavioral parity fixtures (CLI vs SDK vs your driver) belong in the dedicated parity suite ([#4296](https://github.com/JSONbored/gittensory/issues/4296)): same `CodingAgentDriverTask` fixture, assert identical **control-flow** outcomes (`ok`, `changedFiles`, `errorReason`), allow transcript/usage blobs to differ.

## Neighborhood map — primitives this driver interacts with

Cross-reference only — each issue owns its implementation.

| Issue | Primitive | How a driver uses it |
|-------|-----------|----------------------|
| [#4269](https://github.com/JSONbored/gittensory/issues/4269) | Git worktree per attempt | Orchestrator creates `task.workingDirectory`; driver must not escape it. |
| [#4271](https://github.com/JSONbored/gittensory/issues/4271) | Immutable acceptance-criteria file | Written before `run()`; driver reads `acceptanceCriteriaPath` as the definition of done. |
| [#4294](https://github.com/JSONbored/gittensory/issues/4294) | JSONL attempt log | Orchestrator/driver wrapper appends structured events per turn (start, tool, finish). |
| [#4311](https://github.com/JSONbored/gittensory/issues/4311) | Cost/turn metering | Driver populates `usage.turnCount` / `usage.durationMs`; orchestrator aggregates spend. |
| [#4289](https://github.com/JSONbored/gittensory/issues/4289) | Driver factory | Selects CLI vs SDK vs future backend at runtime. |
| [#4296](https://github.com/JSONbored/gittensory/issues/4296) | Parity/contract tests | Guards that every backend honors the same interface semantics. |

## Worked example — one attempt lifecycle (abbreviated)

Scenario: maintainer/miner orchestrator runs **attempt 2** on issue `#1234` after attempt 1 timed out.

1. **Isolate** ([#4269](https://github.com/JSONbored/gittensory/issues/4269)) — orchestrator creates `worktrees/attempt-2/` and sets `workingDirectory` to its absolute path.
2. **Acceptance criteria** ([#4271](https://github.com/JSONbored/gittensory/issues/4271)) — writes `worktrees/attempt-2/.gittensory-acceptance.md` (immutable for this attempt) and sets `acceptanceCriteriaPath`.
3. **Factory** ([#4289](https://github.com/JSONbored/gittensory/issues/4289)) — resolves `CODING_AGENT_DRIVER=cli-subprocess` (or `agent-sdk`) and constructs a `CodingAgentDriver`.
4. **Attempt log opens** ([#4294](https://github.com/JSONbored/gittensory/issues/4294)) — JSONL file `attempt-2.jsonl` receives `{ "event": "attempt_start", … }`.
5. **`driver.run(task)`** ([#4262](https://github.com/JSONbored/gittensory/issues/4262)) — backend edits files only under `workingDirectory`, reading the criteria file between turns, stopping at `turnBudgetCeiling`.
6. **Metering** ([#4311](https://github.com/JSONbored/gittensory/issues/4311)) — result includes `usage: { turnCount: 8, durationMs: 240_000 }`; orchestrator records spend.
7. **Log close** ([#4294](https://github.com/JSONbored/gittensory/issues/4294)) — `{ "event": "attempt_finish", "ok": true, "changedFiles": ["src/retry.ts"] }`.
8. **Downstream** — orchestrator diffs `changedFiles`, runs local validation against the criteria file, and decides whether to open attempt 3 ([#2333](https://github.com/JSONbored/gittensory/issues/2333) iterate loop). **No gate check-run mutation occurs in this path.**

```text
orchestrator
  ├─ worktree isolation (#4269) → workingDirectory
  ├─ write acceptance criteria (#4271) → acceptanceCriteriaPath
  ├─ factory (#4289) → CodingAgentDriver instance
  ├─ open attempt log (#4294)
  ├─ driver.run(task) (#4262 / #4266|#4267)
  ├─ record metering (#4311) ← result.usage
  └─ close attempt log (#4294) → hand off to iterate orchestrator (#2333)
```

## Related documentation

- [`miner-goal-spec.md`](./miner-goal-spec.md) — per-repo miner targeting config (Wave 1).
- [`cross-repo-discovery-phase1.md`](./cross-repo-discovery-phase1.md) — metadata-only discovery scope (Wave 1).
- [`src/selfhost/ai.ts`](../../../src/selfhost/ai.ts) — `SelfHostAi` precedent and `SpawnFn` injection.

## Acceptance (#4312)

- [x] `packages/gittensory-miner/docs/coding-agent-driver.md` documents what `CodingAgentDriver` is, why it exists, and the `SelfHostAi` design rationale.
- [x] Driver-authoring guide covers a third implementation: interface contract, DI, factory hook ([#4289](https://github.com/JSONbored/gittensory/issues/4289)), parity suite ([#4296](https://github.com/JSONbored/gittensory/issues/4296)).
- [x] Cross-references ([#4269](https://github.com/JSONbored/gittensory/issues/4269), [#4271](https://github.com/JSONbored/gittensory/issues/4271), [#4294](https://github.com/JSONbored/gittensory/issues/4294), [#4311](https://github.com/JSONbored/gittensory/issues/4311)) without duplicating their specs.
- [x] Abbreviated end-to-end attempt lifecycle worked example.
