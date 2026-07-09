// Contract tests for the CodingAgentDriver seam (#4262). Locks the interface shape before CLI (#4266) and
// Agent-SDK (#4267) drivers land; parity suite (#4296) extends this with shared behavioral fixtures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  type CodingAgentDriver,
  type CodingAgentDriverResult,
  type CodingAgentDriverTask,
} from "../dist/index.js";

const sourcePath = join(process.cwd(), "src/miner/coding-agent-driver.ts");

const sampleTask: CodingAgentDriverTask = {
  workingDirectory: "/tmp/miner-attempt-1",
  acceptanceCriteriaPath: "/tmp/miner-attempt-1/.gittensory-acceptance.md",
  instructions: "Implement the retry helper described in issue #1234.",
  turnBudgetCeiling: 12,
};

function createFakeDriver(result: CodingAgentDriverResult): CodingAgentDriver {
  return {
    async run(task) {
      assert.equal(task.workingDirectory, sampleTask.workingDirectory);
      assert.equal(task.acceptanceCriteriaPath, sampleTask.acceptanceCriteriaPath);
      assert.equal(task.instructions, sampleTask.instructions);
      assert.equal(task.turnBudgetCeiling, sampleTask.turnBudgetCeiling);
      return result;
    },
  };
}

test("CodingAgentDriver: a minimal fake driver satisfies the interface contract", async () => {
  const driver = createFakeDriver({
    ok: true,
    changedFiles: ["src/retry.ts"],
    transcript: "Added retry helper.",
    usage: { turnCount: 3, durationMs: 4_200 },
  });
  const outcome = await driver.run(sampleTask);
  assert.deepEqual(outcome, {
    ok: true,
    changedFiles: ["src/retry.ts"],
    transcript: "Added retry helper.",
    usage: { turnCount: 3, durationMs: 4_200 },
  });
});

test("CodingAgentDriver: failure results carry errorReason without leaking provider fields into shared types", async () => {
  const driver = createFakeDriver({
    ok: false,
    changedFiles: [],
    errorReason: "turn_budget_exceeded",
    usage: { turnCount: 12, provider: { backend: "fake" } },
  });
  const outcome = await driver.run(sampleTask);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errorReason, "turn_budget_exceeded");
  assert.deepEqual(outcome.changedFiles, []);
});

test("coding-agent-driver.ts documents the SelfHostAi mirror and DI convention", () => {
  const source = readFileSync(sourcePath, "utf8");
  assert.match(source, /SelfHostAi/);
  assert.match(source, /SpawnFn/);
  assert.match(source, /run\(\)/);
});
