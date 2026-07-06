import type { GitHubWebhookPayload } from "../types";

/** Discriminated union for PR-thread @gittensory command webhook preambles (#2161). Mirrors
 *  classifyPlanCommandRequest (src/review/planner.ts) but for PR comments: issue.pull_request must
 *  be present. Handlers consume the ok branch; skip reasons match maybeProcessGateOverrideCommand. */
export type PrCommandRequest =
  | {
      ok: true;
      repoFullName: string;
      installationId: number;
      actor: string;
      issue: { number: number; title?: string | null | undefined; body?: string | null | undefined };
    }
  | { ok: false; reason: string; repoFullName: string | null; actor: string | null; targetKey: string | null };

export function classifyPrCommandRequest(
  payload: GitHubWebhookPayload,
  installationId: number | null,
): PrCommandRequest {
  const comment = payload.comment;
  const repoFullName = payload.repository?.full_name ?? null;
  const issue = payload.issue ?? null;
  const actor = payload.sender?.login ?? comment?.user?.login ?? null;
  const targetKey = repoFullName && issue ? `${repoFullName}#${issue.number}` : repoFullName;

  if (payload.action !== "created") {
    return { ok: false, reason: "unsupported_comment_action", repoFullName, actor, targetKey };
  }
  if (comment?.user?.type === "Bot" || payload.sender?.type === "Bot" || /\[bot\]$/i.test(actor ?? "")) {
    return { ok: false, reason: "bot_author", repoFullName, actor, targetKey };
  }
  if (!repoFullName || !issue?.pull_request || !installationId || !actor) {
    return { ok: false, reason: "missing_repo_pr_installation_or_actor", repoFullName, actor, targetKey };
  }
  return {
    ok: true,
    repoFullName,
    installationId,
    actor,
    issue: { number: issue.number, title: issue.title, body: issue.body },
  };
}
