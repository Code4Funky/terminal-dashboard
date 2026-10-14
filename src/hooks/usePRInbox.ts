import { useState, useEffect, useCallback } from "react";
import type { GhPRNode } from "./useTerminal";
import { teamMatchSet, type UpdatedWindow } from "../prs";

export interface RepoEntry { name: string; branches: string[]; repoUrl: string }

const CACHE_KEY = "tdash:pr-inbox-cache";
interface InboxCache { prs: GhPRNode[]; repos: RepoEntry[]; at: number }

// The fan-out takes seconds; the last result paints instantly while the refresh runs behind it.
function readInboxCache(): InboxCache | null {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as InboxCache | null;
    return c && Array.isArray(c.prs) && Array.isArray(c.repos) ? c : null;
  } catch { return null; }
}

/**
 * The open-PR fan-out over every local clone, owned once at the Dashboard level. Both the PRs panel
 * and the Sessions panel's `N need you` row read it, so neither re-fetches — and the drawer no longer
 * pays the ~9s fan-out every time it remounts.
 */
export function usePRInbox() {
  const [cached] = useState(readInboxCache);
  const [prs, setPRs] = useState<GhPRNode[]>(() => cached?.prs ?? []);
  const [repos, setRepos] = useState<RepoEntry[]>(() => cached?.repos ?? []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(() => (cached ? new Date(cached.at) : new Date()));
  const [ghLogin, setGhLogin] = useState<string | null>(null);
  const [myTeams, setMyTeams] = useState<Set<string>>(new Set());
  const [updatedWithin, setUpdatedWithinState] = useState<UpdatedWindow>(
    () => (localStorage.getItem("tdash:prs-updated-window") as UpdatedWindow) ?? "3mo"
  );

  const setUpdatedWithin = useCallback((w: UpdatedWindow) => {
    setUpdatedWithinState(w);
    localStorage.setItem("tdash:prs-updated-window", w);
  }, []);

  const reload = useCallback(() => {
    setLoading(true); setError(null);
    window.terminal.listGithubRepos()
      .then((repoList) => {
        setRepos(repoList);
        return window.terminal.listPRs(repoList.map((r) => r.name)).then((data) => {
          setPRs(data);
          const at = Date.now();
          setLastRefreshed(new Date(at));
          // Best-effort: a quota failure only costs the next boot's instant paint.
          try { localStorage.setItem(CACHE_KEY, JSON.stringify({ prs: data, repos: repoList, at })); } catch {}
        });
      })
      .then(() => setLoading(false))
      .catch((err: Error) => { setError(err.message ?? "Failed to load PRs"); setLoading(false); });
  }, []);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    const interval = setInterval(reload, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [reload]);

  useEffect(() => {
    window.terminal.getGhLogin().then(setGhLogin).catch(() => setGhLogin(null));
    window.terminal.getMyTeams()
      .then((teams) => setMyTeams(teamMatchSet(teams)))
      .catch(() => setMyTeams(new Set()));
  }, []);

  return { prs, repos, loading, error, lastRefreshed, ghLogin, myTeams, updatedWithin, setUpdatedWithin, reload };
}
