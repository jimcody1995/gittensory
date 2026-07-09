// CodingAgentDriver seam (#4262) — the miner "hands" interface.
//
// Mirrors `SelfHostAi` in `src/selfhost/ai.ts`: a single `run()` method with several concrete backends
// (CLI subprocess #4266, Agent SDK #4267, future providers) selected at runtime by a provider-name factory
// (#4289). Implementations MAY perform real IO; anything a test needs to control (spawn, clock, filesystem)
// is injected at construction time — the same convention as `SpawnFn` on `createClaudeCodeAi` /
// `createCodexAi` (`src/selfhost/ai.ts`).
//
// This interface performs NO network calls, NO GitHub writes, and NO autonomous continue/stop decisions.
// Orchestration (iterate loop, claim/PR lifecycle) is maintainer-owned (#2333).

/** Scoped local task for one coding-agent attempt. Provider-agnostic — no subprocess vs SDK assumptions. */
export type CodingAgentDriverTask = {
  /** Absolute path to the isolated working tree for this attempt (see worktree isolation, #4269). */
  workingDirectory: string;
  /** Path to the immutable acceptance-criteria file written before the agent starts (#4271). */
  acceptanceCriteriaPath: string;
  /** Operator/miner instructions for this attempt (goal, constraints, issue context). */
  instructions: string;
  /** Hard ceiling on agent turns/tool rounds; drivers enforce and report usage against it (#4311). */
  turnBudgetCeiling: number;
};

/** Opaque provider usage blob — not interpreted for control flow by the orchestrator (#4311). */
export type CodingAgentDriverUsageSummary = {
  turnCount?: number;
  durationMs?: number;
  provider?: Record<string, unknown>;
};

/** Structured outcome of one driver `run()`. */
export type CodingAgentDriverResult = {
  ok: boolean;
  /** Repo-relative paths changed under `workingDirectory` (empty when `ok` is false or no edits). */
  changedFiles: readonly string[];
  /** Human-readable attempt summary for logs/UI; not parsed for control flow. */
  transcript?: string;
  usage?: CodingAgentDriverUsageSummary;
  /** Populated when `ok` is false; stable machine reason preferred over raw stderr. */
  errorReason?: string;
};

/**
 * Provider-agnostic coding-agent backend. One attempt = one `run()` call scoped to `workingDirectory`.
 */
export interface CodingAgentDriver {
  run(task: CodingAgentDriverTask): Promise<CodingAgentDriverResult>;
}
