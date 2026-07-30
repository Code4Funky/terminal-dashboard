import type { GhPRNode } from "./hooks/useTerminal";

/**
 * Pure PR-inbox domain: how a PR is bucketed and whether it falls inside the Updated window.
 * Shared by `usePRInbox`, `PRsDrawer` and the Sessions panel's `N need you` count, so the three
 * can never disagree about what "needs your review" means.
 */

export type PRCategory =
  | "needsYourReview" | "needsTeamReview" | "yourDrafts" | "waiting" | "needsAction" | "readyToMerge";

export const PR_CATEGORIES: { key: PRCategory; label: string }[] = [
  { key: "needsYourReview", label: "Needs your review" },
  { key: "needsTeamReview", label: "Needs your teams' review" },
  { key: "yourDrafts", label: "Your drafts" },
  { key: "waiting", label: "Waiting for review or checks" },
  { key: "needsAction", label: "Needs action" },
  { key: "readyToMerge", label: "Ready to merge" },
];

// `gh pr list` puts the org-qualified team in `slug` ("Skedulo/v3-backend-core") and the bare one in
// `name`, so check both against a set holding both forms. Empty myTeams (no `read:org` scope) falls
// back to matching any team request rather than emptying the section.
function requestedFromMyTeam(pr: GhPRNode, myTeams: Set<string>): boolean {
  return pr.reviewRequests?.some((r) => {
    if (r.__typename !== "Team") return false;
    if (myTeams.size === 0) return true;
    return (!!r.slug && myTeams.has(r.slug)) || (!!r.name && myTeams.has(r.name));
  });
}

// Both `org/slug` and bare `slug`, since either can show up on a review request.
export function teamMatchSet(teams: string[]): Set<string> {
  return new Set(teams.flatMap((t) => [t, t.split("/").pop() ?? t]));
}

export function categorizePR(pr: GhPRNode, ghLogin: string | null, myTeams: Set<string>): PRCategory | null {
  if (ghLogin && pr.author.login === ghLogin) {
    if (pr.isDraft) return "yourDrafts";
    if (pr.reviewDecision === "CHANGES_REQUESTED") return "needsAction";
    const ciFailing = pr.statusCheckRollup?.some((c) =>
      c.conclusion === "FAILURE" || c.conclusion === "TIMED_OUT" || c.conclusion === "CANCELLED" ||
      c.state === "FAILURE" || c.state === "ERROR"
    );
    if (ciFailing) return "needsAction";
    if (pr.reviewDecision === "APPROVED" && pr.mergeable !== "CONFLICTING") return "readyToMerge";
    return "waiting";
  }
  if (pr.reviewRequests?.some((r) => r.__typename === "User" && r.login === ghLogin)) return "needsYourReview";
  if (requestedFromMyTeam(pr, myTeams)) return "needsTeamReview";
  return null;
}

export type UpdatedWindow = "1mo" | "3mo" | "1y" | "any";

export const UPDATED_WINDOWS: { key: UpdatedWindow; label: string; days: number | null }[] = [
  { key: "1mo", label: "Last month",    days: 30 },
  { key: "3mo", label: "Last 3 months", days: 90 },
  { key: "1y",  label: "Last year",     days: 365 },
  { key: "any", label: "Any time",      days: null },
];

// Filtered client-side on `updatedAt` (already fetched) rather than via `gh --search`: the search API's
// secondary rate limit is far tighter than the repo endpoints, and this makes the toggle instant.
export function withinUpdatedWindow(pr: GhPRNode, updatedWithin: UpdatedWindow): boolean {
  const days = UPDATED_WINDOWS.find((w) => w.key === updatedWithin)?.days;
  if (!days) return true;
  return Date.now() - new Date(pr.updatedAt).getTime() <= days * 86400000;
}

/** Bucket once — uncategorised PRs render nowhere, so a count of the buckets is the real inbox size. */
export function bucketPRs(
  prs: GhPRNode[], ghLogin: string | null, myTeams: Set<string>, updatedWithin: UpdatedWindow,
): Partial<Record<PRCategory, GhPRNode[]>> {
  return prs.reduce<Partial<Record<PRCategory, GhPRNode[]>>>((acc, pr) => {
    if (!withinUpdatedWindow(pr, updatedWithin)) return acc;
    const key = categorizePR(pr, ghLogin, myTeams);
    if (key) (acc[key] ??= []).push(pr);
    return acc;
  }, {});
}
