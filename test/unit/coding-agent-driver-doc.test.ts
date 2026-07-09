import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const docPath = join(repoRoot, "packages/gittensory-miner/docs/coding-agent-driver.md");
const interfacePath = join(repoRoot, "packages/gittensory-engine/src/miner/coding-agent-driver.ts");

const CROSS_REF_ISSUES = ["4262", "4266", "4267", "4269", "4271", "4289", "4294", "4296", "4311"] as const;

describe("CodingAgentDriver docs (#4312)", () => {
  it("documents the seam, SelfHostAi rationale, and driver-authoring guide", () => {
    const doc = readFileSync(docPath, "utf8");
    expect(doc).toContain("# CodingAgentDriver seam (miner hands)");
    expect(doc).toContain("SelfHostAi");
    expect(doc).toContain("Driver-authoring guide");
    expect(doc).toContain("packages/gittensory-engine/src/miner/coding-agent-driver.ts");
    expect(doc).toContain("SpawnFn");
    expect(doc).toContain("turnBudgetCeiling");
    expect(doc).toContain("acceptanceCriteriaPath");
    expect(doc).toContain("Worked example");
    expect(doc).toContain("check-docs-drift.mjs");
  });

  it("cross-references the miner-hands batch issues without duplicating their full specs", () => {
    const doc = readFileSync(docPath, "utf8");
    for (const issue of CROSS_REF_ISSUES) {
      expect(doc).toContain(`#${issue}`);
    }
    expect(doc).toContain("Neighborhood map");
  });

  it("matches the settled interface export in gittensory-engine", () => {
    const doc = readFileSync(docPath, "utf8");
    const source = readFileSync(interfacePath, "utf8");
    expect(doc).toContain("CodingAgentDriverTask");
    expect(doc).toContain("CodingAgentDriverResult");
    expect(source).toContain("export interface CodingAgentDriver");
    expect(source).toContain("run(task: CodingAgentDriverTask)");
    expect(source).toMatch(/workingDirectory/);
    expect(source).toMatch(/acceptanceCriteriaPath/);
    expect(source).toMatch(/turnBudgetCeiling/);
  });
});
