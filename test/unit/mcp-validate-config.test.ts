import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { GittensoryMcp } from "../../src/mcp/server";
import { createTestEnv } from "../helpers/d1";

async function connect() {
  const server = new GittensoryMcp(createTestEnv()).createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "gittensory-validate-config-test", version: "0.1.0" }, { capabilities: {} });
  await client.connect(clientTransport);
  return client;
}

type ValidateConfigData = {
  present: boolean;
  normalized: Record<string, unknown>;
  warnings: string[];
  recognizedFields: string[];
  summary: string;
};

describe("MCP gittensory_validate_config (#2057)", () => {
  it("validates a single-field manifest (no repo/auth needed) and normalizes it with no warnings", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "gittensory_validate_config",
      arguments: { content: "wantedPaths:\n  - src/\n" },
    });

    expect(result.isError).toBeFalsy();
    const data = result.structuredContent as ValidateConfigData;
    expect(data.present).toBe(true);
    expect(data.warnings).toEqual([]);
    expect(data.recognizedFields).toEqual(["wantedPaths"]);
    // normalized comes from the SAME parser/serializer the loader persists — single source of truth.
    expect(data.normalized.source).toBe("repo_file");
    expect(data.normalized.wantedPaths).toEqual(["src/"]);
    expect((result.content as Array<{ text: string }>)[0]?.text).toContain(
      "Manifest valid: 1 recognized field, no warnings.",
    );
  });

  it("pluralizes the recognized-field count for a multi-field manifest", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "gittensory_validate_config",
      arguments: { content: "gate:\n  enabled: true\nreview:\n  profile: chill\n" },
    });

    const data = result.structuredContent as ValidateConfigData;
    expect(data.present).toBe(true);
    expect(data.warnings).toEqual([]);
    expect(data.recognizedFields).toEqual(["gate", "review"]);
    expect((result.content as Array<{ text: string }>)[0]?.text).toContain(
      "Manifest valid: 2 recognized fields, no warnings.",
    );
  });

  it("reports a single warning for malformed YAML without throwing", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "gittensory_validate_config",
      arguments: { content: "wantedPaths: [unterminated" },
    });

    expect(result.isError).toBeFalsy();
    const data = result.structuredContent as ValidateConfigData;
    expect(data.present).toBe(false);
    expect(data.recognizedFields).toEqual([]);
    expect(data.warnings).toEqual([
      "Manifest content was not valid YAML; ignoring it and falling back to deterministic signals.",
    ]);
    expect((result.content as Array<{ text: string }>)[0]?.text).toContain("Manifest has 1 warning.");
  });

  it("pluralizes multiple warnings and never echoes supplied values back", async () => {
    const client = await connect();
    const result = await client.callTool({
      name: "gittensory_validate_config",
      arguments: { content: "wantedPaths: [src/]\nblockedPaths: [dist/]\nunknownSecretKey: super-secret-value\n" },
    });

    const data = result.structuredContent as ValidateConfigData;
    expect(data.present).toBe(true);
    expect(data.recognizedFields).toEqual(["wantedPaths"]);
    expect(data.warnings).toEqual([
      "blockedPaths is retired; use settings.hardGuardrailGlobs for path holds.",
      "Manifest contains unknown top-level field: unknownSecretKey.",
    ]);
    expect((result.content as Array<{ text: string }>)[0]?.text).toContain("Manifest has 2 warnings.");
    expect(JSON.stringify(result)).not.toContain("super-secret-value");
  });
});
