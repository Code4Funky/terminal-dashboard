import type { CSSProperties, ReactNode } from "react";
import { useTheme } from "../ThemeContext";
import { MONO_FONT, TABULAR } from "../theme";
import { CLIP_LEFT } from "../chrome";
import type { RepoStatus } from "../hooks/useTerminal";

/** What the strip knows about the PR inbox. Counts come pre-bucketed so the strip and the PRs panel
 *  can never disagree about how many PRs are "open". */
export interface PRStatus {
  open: number;
  needYou: number;
  lastRefreshed: Date;
  loading: boolean;
  error: string | null;
}

interface Props {
  repo: RepoStatus | null;
  prs: PRStatus;
  /** `bar` is one 26px row across the window; `footer` stacks the two groups for a 264px column. */
  layout: "bar" | "footer";
}

/** Bare elapsed figure — "now", "4m", "2h", "3d". Shared with the sidebar's session rows so a
 *  session's last-output stamp and the sync label never read the same age two different ways. */
export function shortAgo(epochMs: number): string {
  const secs = Math.max(0, Math.floor((Date.now() - epochMs) / 1000));
  if (secs < 60) return "now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function StatusStrip({ repo, prs, layout }: Props) {
  const { theme: t } = useTheme();
  const footer = layout === "footer";

  const row: CSSProperties = {
    display: "flex", alignItems: "center", gap: 6, minWidth: 0,
    fontSize: 11, color: t.label3, ...MONO_FONT, ...TABULAR,
  };

  // Keys are explicit because the separators are woven in after filtering
  const join = (parts: (ReactNode | null)[]) =>
    parts.filter(Boolean).flatMap((p, i) =>
      i === 0 ? [p] : [<span key={`sep${i}`} style={{ color: t.label4, flex: "none" }}>·</span>, p]);

  const repoParts: (ReactNode | null)[] = repo
    ? [
        // ⟳ means "a working tree", the same meaning Phase 2 gave the shell rows. ⎇ is an agent's branch.
        // It sits outside the clipped span: CLIP_LEFT is `direction: rtl`, which reorders a leading
        // neutral glyph to the far end — the branch reads "cowork ⟳" if you nest it.
        <span key="branch" title={repo.branch} style={{ display: "flex", alignItems: "center", gap: 5, flex: "0 1 auto", minWidth: 0, color: t.label2 }}>
          <span style={{ flex: "none" }}>⟳</span>
          <span style={{ maxWidth: footer ? 132 : 240, ...CLIP_LEFT }}>{repo.branch}</span>
        </span>,
        repo.ahead > 0 || repo.behind > 0 ? (
          <span key="sync" style={{ flex: "none" }} title={`${repo.ahead} ahead, ${repo.behind} behind upstream`}>
            {repo.ahead > 0 && <span style={{ color: t.green }}>↑{repo.ahead}</span>}
            {repo.ahead > 0 && repo.behind > 0 && " "}
            {repo.behind > 0 && <span style={{ color: t.orange }}>↓{repo.behind}</span>}
          </span>
        ) : null,
        <span key="changed" style={{ flex: "none", color: repo.changed > 0 ? t.label2 : t.label4 }}>
          {repo.changed} changed
        </span>,
      ]
    : [<span key="norepo" style={{ flex: "none", color: t.label4 }}>No repo</span>];

  const sync = prs.error
    ? { color: t.red, label: "sync failed", title: prs.error }
    : prs.loading
      ? { color: t.orange, label: "syncing…", title: "Fetching pull requests" }
      : { color: t.green, label: `synced ${shortAgo(prs.lastRefreshed.getTime())}`, title: `Last refreshed ${prs.lastRefreshed.toLocaleTimeString()}` };

  const prParts: (ReactNode | null)[] = [
    // A count is only honest once the fan-out has resolved — until then the sync dot carries the state.
    prs.loading ? null : (
      <span key="open" style={{ flex: "none", color: prs.open > 0 ? t.label2 : t.label4 }}>
        {plural(prs.open, "open PR")}
      </span>
    ),
    // Hidden at 0, matching the Sessions cross-link: "0 need you" is noise the empty state already covers.
    !prs.loading && prs.needYou > 0 ? (
      <span key="needyou" style={{ flex: "none", color: t.blue }}>{prs.needYou} need you</span>
    ) : null,
    <span key="synced" title={sync.title} style={{ flex: "none", display: "inline-flex", alignItems: "center", gap: 5, color: t.label3 }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: sync.color, flexShrink: 0 }} />
      {sync.label}
    </span>,
  ];

  if (footer) {
    return (
      <div style={{
        flexShrink: 0, display: "flex", flexDirection: "column", gap: 3,
        padding: "7px 12px", borderTop: `1px solid ${t.border}`, overflow: "hidden",
      }}>
        <div style={row}>{join(repoParts)}</div>
        <div style={row}>{join(prParts)}</div>
      </div>
    );
  }

  return (
    <div style={{
      height: 26, flexShrink: 0, display: "flex", alignItems: "center", gap: 6,
      padding: "0 10px", background: t.surface1, borderTop: `1px solid ${t.border}`,
      WebkitAppRegion: "no-drag", ...row,
    } as CSSProperties}>
      {join(repoParts)}
      <span style={{ flex: 1, minWidth: 0 }} />
      {join(prParts)}
    </div>
  );
}
