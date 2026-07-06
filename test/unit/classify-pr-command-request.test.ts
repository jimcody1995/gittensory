import { describe, expect, it } from "vitest";
import { classifyPrCommandRequest } from "../../src/github/classify-pr-command-request";
import type { GitHubWebhookPayload } from "../../src/types";

describe("classifyPrCommandRequest (#2161)", () => {
  const base = (over: Record<string, unknown> = {}): GitHubWebhookPayload =>
    ({
      action: "created",
      repository: { full_name: "acme/widgets" },
      issue: { number: 42, title: "PR title", state: "open", body: "PR body", pull_request: {} },
      comment: { id: 1, body: "@gittensory gate-override", user: { login: "maint", type: "User" } },
      sender: { login: "maint", type: "User" },
      ...over,
    }) as unknown as GitHubWebhookPayload;

  it("returns ok with validated PR-thread fields", () => {
    expect(classifyPrCommandRequest(base(), 123)).toEqual({
      ok: true,
      repoFullName: "acme/widgets",
      installationId: 123,
      actor: "maint",
      issue: { number: 42, title: "PR title", body: "PR body" },
    });
  });

  it("skips non-created comment actions with unsupported_comment_action", () => {
    expect(classifyPrCommandRequest(base({ action: "edited" }), 123)).toMatchObject({
      ok: false,
      reason: "unsupported_comment_action",
      targetKey: "acme/widgets#42",
    });
    expect(classifyPrCommandRequest(base({ action: "deleted" }), 123)).toMatchObject({
      ok: false,
      reason: "unsupported_comment_action",
    });
  });

  it("skips bot authors with bot_author", () => {
    expect(
      classifyPrCommandRequest(
        base({ comment: { id: 1, body: "@gittensory gate-override", user: { login: "bot", type: "Bot" } } }),
        123,
      ),
    ).toMatchObject({ ok: false, reason: "bot_author", targetKey: "acme/widgets#42" });
    expect(classifyPrCommandRequest(base({ sender: { login: "x", type: "Bot" } }), 123)).toMatchObject({
      ok: false,
      reason: "bot_author",
    });
    expect(classifyPrCommandRequest(base({ sender: { login: "renovate[bot]", type: "User" } }), 123)).toMatchObject({
      ok: false,
      reason: "bot_author",
    });
  });

  it("skips when repo, PR issue, installation, or actor is missing", () => {
    expect(classifyPrCommandRequest(base({ repository: undefined }), 123)).toMatchObject({
      ok: false,
      reason: "missing_repo_pr_installation_or_actor",
      repoFullName: null,
      targetKey: null,
    });
    expect(classifyPrCommandRequest(base({ issue: undefined }), 123)).toMatchObject({
      ok: false,
      reason: "missing_repo_pr_installation_or_actor",
      targetKey: "acme/widgets",
    });
    expect(
      classifyPrCommandRequest(base({ issue: { number: 42, title: "T", state: "open", body: "B" } }), 123),
    ).toMatchObject({
      ok: false,
      reason: "missing_repo_pr_installation_or_actor",
    });
    expect(classifyPrCommandRequest(base(), null)).toMatchObject({
      ok: false,
      reason: "missing_repo_pr_installation_or_actor",
    });
    expect(
      classifyPrCommandRequest(
        base({ sender: undefined, comment: { id: 1, body: "@gittensory gate-override", user: undefined } }),
        123,
      ),
    ).toMatchObject({
      ok: false,
      reason: "missing_repo_pr_installation_or_actor",
      actor: null,
    });
  });
});
