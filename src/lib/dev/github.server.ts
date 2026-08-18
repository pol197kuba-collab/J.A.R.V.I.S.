// Minimal GitHub REST client for the Dev Wing (D.R.O.I.D. coordinator).
// Deliberately thin — just the handful of endpoints start_dev_session and
// check_dev_session need, using the user's own token (user_secrets.github_token,
// BYOK — same pattern as the Gemini/Groq keys). Never logs the token itself.

const API_BASE = "https://api.github.com";

export class GithubApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "GithubApiError";
  }
}

async function githubFetch(
  token: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    // GitHub error bodies are JSON with a `message` field — best-effort, the
    // raw status is what actually matters for the caller's branching logic.
    let message = `GitHub API ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body?.message) message = `GitHub API ${res.status}: ${body.message}`;
    } catch {
      /* ignore — non-JSON error body, keep the generic message */
    }
    throw new GithubApiError(res.status, message);
  }
  if (res.status === 204) return null;
  return res.json();
}

export async function createIssue(
  token: string,
  owner: string,
  repo: string,
  title: string,
  body: string,
): Promise<{ number: number; htmlUrl: string }> {
  const data = (await githubFetch(token, `/repos/${owner}/${repo}/issues`, {
    method: "POST",
    body: { title, body },
  })) as { number: number; html_url: string };
  return { number: data.number, htmlUrl: data.html_url };
}

type TimelineEvent = {
  event: string;
  source?: { issue?: { number: number; pull_request?: unknown; html_url: string } };
};

/**
 * An issue Claude Code Action worked on gets a "cross-referenced" timeline
 * event once it opens a PR that mentions the issue (e.g. "Closes #N") — this
 * scans for the most recent one. Returns null if no PR has shown up yet.
 */
export async function findLinkedPullRequest(
  token: string,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<{ number: number; htmlUrl: string } | null> {
  const events = (await githubFetch(
    token,
    `/repos/${owner}/${repo}/issues/${issueNumber}/timeline?per_page=100`,
  )) as TimelineEvent[];
  const prEvents = events.filter(
    (e) => e.event === "cross-referenced" && e.source?.issue?.pull_request,
  );
  const last = prEvents[prEvents.length - 1];
  if (!last?.source?.issue) return null;
  return { number: last.source.issue.number, htmlUrl: last.source.issue.html_url };
}

export type PullRequestStatus = {
  state: "open" | "closed";
  merged: boolean;
  htmlUrl: string;
  headSha: string;
  /** Combined CI conclusion across all check runs on the head commit. */
  ci: "pending" | "success" | "failure" | "none";
};

export async function getPullRequestStatus(
  token: string,
  owner: string,
  repo: string,
  number: number,
): Promise<PullRequestStatus> {
  const pr = (await githubFetch(token, `/repos/${owner}/${repo}/pulls/${number}`)) as {
    state: "open" | "closed";
    merged: boolean;
    html_url: string;
    head: { sha: string };
  };

  const checks = (await githubFetch(
    token,
    `/repos/${owner}/${repo}/commits/${pr.head.sha}/check-runs?per_page=100`,
  )) as { check_runs: { status: string; conclusion: string | null }[] };

  let ci: PullRequestStatus["ci"] = "none";
  if (checks.check_runs.length > 0) {
    const anyPending = checks.check_runs.some((c) => c.status !== "completed");
    const anyFailed = checks.check_runs.some(
      (c) => c.status === "completed" && c.conclusion !== "success" && c.conclusion !== "neutral",
    );
    ci = anyPending ? "pending" : anyFailed ? "failure" : "success";
  }

  return {
    state: pr.state,
    merged: pr.merged,
    htmlUrl: pr.html_url,
    headSha: pr.head.sha,
    ci,
  };
}
