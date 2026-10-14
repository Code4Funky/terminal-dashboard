# Todo

## Recently used skills in the Stats drawer (2026-08-12)

**Source** (measured over the whole transcript corpus, not assumed). Two forms, 176 raw events
all-time across 11 distinct skills:

| form | shape | count |
|---|---|---|
| `Skill` tool call | assistant `content[].tool_use`, `name:"Skill"`, `input.skill` | 66 |
| slash command | user text `<command-name>/name</command-name>` | 222, but most are CLI built-ins |

**Filter, and why it is asymmetric.** A `Skill` tool_use is by construction a skill invocation, so it
is counted unconditionally. The `<command-name>` stream is *not* — it carries `/exit` (50), `/model`
(16), `/clear`, `/mcp`, `/resume`, `/context`, `/rename` — so it alone is resolved against skills on
disk: any `SKILL.md` directory or `commands/*.md` basename under `~/.claude` (personal + every plugin
cache and marketplace).

> Applying the disk filter to *both* forms — the literal reading of the agreed rule — was measured and
> rejected: `simplify` (42 runs, the most-used skill) no longer exists on disk, and neither do
> `update-config`, `run` or the three `create-*-class` skills. Resolving everything against disk
> silently erases every skill that was later deleted or renamed, i.e. exactly the history a stats
> panel exists to show. Built-ins never appear as `Skill` tool calls, so the filter is only needed
> where the false positives actually are.

De-dup: same `(sessionId, skill)` inside 120 s collapses to one, since a typed `/skill` can produce
both forms. Measured effect: 176 → 175, so the two forms are near-disjoint in practice.

**Agreed layout** — new section on the Overview tab, below GitHub Repos, mirroring its shape
(two summary cards over a card-wrapped list). Respects the drawer's existing All / 30d / 7d filter.

```
◇ Skills · 30d

┌────────────────────┐┌────────────────────┐
│ Top skill          ││ Skills used        │
│ simplify           ││ 11                 │
│ 14 runs            ││ 33 runs total      │
└────────────────────┘└────────────────────┘
┌──────────────────────────────────────────┐
│ ordered by last use                      │
│ simplify          14×  mobile-edge    2h │
│ action-coderabbit  9×  mobile-edge    5h │
│ create-pr          3×  terminal-dash  1d │
└──────────────────────────────────────────┘
```

- [x] Main: known-skill name set from disk; tally both forms inside the existing
      `computeClaudeStatsUncached` pass; return a flat `skillUses[]` (name, ts, repo)
- [x] StatsDrawer: aggregate within the active filter window, order by last use, render the section
- [x] Verify: tsc both projects, then drive the built app and read the section

### Review

Built as specced. Notes on the two places the implementation departed from the sketch:

- **The list is one CSS grid, not a row of flex rows.** With per-row flex the columns only line up
  when every repo name is the same length — `goto-repo · tungtran` pushed its `1×` out of the column.
  `gridTemplateColumns: minmax(0,1fr) auto auto auto` over the whole list sizes each column to its
  widest cell with no hand-tuned widths. Cost: the name column now yields to the repo column, so
  `create-controller-endpoint` ellipses to `create-controller-endpoi…` (full name in the `title`).
- **The window boundary is the existing `overviewCutoff` date string**, not a new numeric cutoff — a
  timestamp is sliced to `YYYY-MM-DD` and string-compared, so the Skills section and the counters at
  the top of the tab can never disagree about where "30d" starts.
- `skillUses` was added to the `getStats` return type in `useTerminal.ts`. That declaration was
  already stale (missing `activeDays`, `allTimeDailyCounts`, …) and is the reason for the
  pre-existing `as ClaudeStats` cast error; I declared my own field and left the rest alone.

**Verified** — `npx tsc --noEmit -p tsconfig.node.json` clean; `-p tsconfig.web.json` 15 errors, the
unchanged baseline. Then `npm run build` and drove the built bundle under a fake `HOME` with `.claude`
symlinked in (safe here — unlike the rename driver, this run only reads). Numbers cross-checked
against a re-derivation written from scratch against the corpus rather than by importing the app's
own helper:

| window | independent scan | UI |
|---|---|---|
| all | 11 skills · 175 runs · top `action-coderabbit` 105 | 11 · 175 · `action-coderabbit` 105 runs |
| 30d | 11 skills · 175 runs | 11 · 175 |
| 7d | 5 skills · 42 runs · top `action-coderabbit` 27 | 5 · 42 · `action-coderabbit` 27 runs |

Row order matched exactly in all three windows. 716 transcripts, 346 skill names resolved on disk,
175 raw events → 175 after de-dup (the two forms did not overlap once in this corpus).

Cold-start cost measured, since the regex now runs over every user message: **461 ms** of extraction
across 116 029 entries in 720 transcripts, on top of a pass that already reads and parses all of them.
No extra file reads, and it sits behind the existing `claudeFilesSignature` memo, so a warm drawer
open pays nothing.

**Not verified:** behaviour when a skill name contains characters outside `[a-z0-9][\w-]{0,48}` — the
`<command-name>` regex would skip it. No such name exists in the corpus or on disk today.

## Claude session name in the Sessions rail (2026-08-12)

Three agent rows on the same repo, branch and PR are indistinguishable in the 264px rail. Claude
already names its sessions — capture that name and make it the row's identity.

**Source** (measured, not assumed). Claude appends title lines to its transcript at
`~/.claude/projects/<slug>/<claudeSessionId>.jsonl`:
`{"type":"custom-title","customTitle":"…"}` on a rename, `{"type":"ai-title","aiTitle":"…"}` for its
own guess. A rename **stops** the ai-title stream, and both are re-emitted as the conversation grows,
so the newest sits within ~25 KB of EOF (worst of 3 sampled; transcripts reach 35 MB — never read
whole on a poll). `state.panelClaudeSessions[panelNumber]` already maps panel → session id + cwd.

**Agreed layout** — title takes line 1, repo drops to line 2, branch moves into the tooltip:

```
  before                              after
  ● mobile-edge-service  needs input  ● Geofence block message  needs input
    ⎇ …3/geofence-block-msg   #1456     mobile-edge-service          #1456
  ● mobile-edge-service               ● Retry backoff spike
    ⎇ …3/geofence-block-msg   #1456     mobile-edge-service          #1456
```

Precedence: hand rename (double-click, `named`) → custom-title → ai-title → repo name (today's
two-line shape, unchanged). ai-title renders one step down the label ramp — it's Claude's guess.

- [x] Main: `claude:get-titles` → `Record<panelNumber, {title, source}>`; tail-read 256 KB, stat-cached,
      one whole-file pass per session as backstop, 30 s negative cache on an unresolved transcript
- [x] Preload + `useTerminal` type decl
- [x] `TerminalTab.named` plumbed from Dashboard — a hand rename must outrank Claude's name
- [x] RepoSidebar: poll while agents are open (5 s, gated on `hasAgents`), render the agreed layout
- [x] Verify: tsc node clean, web at the 15-error baseline (same messages, unchanged files); driven
      through Playwright against the built bundle

**Verified** on a throwaway instance (temp `HOME`, the user's real `state.json`, transcripts copied
rather than symlinked so the run could append a rename without touching real Claude data):

| | rail row |
|---|---|
| custom-title | `debug skill` / `mobile-edge-service` |
| custom-title | `kiok push` / `skills` |
| ai-title | `Capture and display session name changes` — `rgb(154,162,178)` vs `rgb(228,231,237)` on an active row |
| no title | `mobile-edge-service` / `⎇ tungtran/MOB-523/…` — old shape, untouched |
| rename mid-run | append a `custom-title` line → row's line 1 flips **1521 ms** later |

Not re-observed in the harness: the `#PR` badge beside the repo on line 2. A throwaway `HOME` has no
persisted repo-root config, so `listPRs(["mobile-edge-service"])` returns `[]` in **0 ms** — no fetch
is attempted and no row can carry a badge. The badge JSX is unchanged by this work and the repo name
is shorter than the branch it replaces, so it has strictly more room than before.

## Live refresh, PR fetch speed, untracked-file diff (2026-07-31)

Three reported defects, root causes confirmed before touching anything:

1. **Changes rail never refreshes on its own** — `loadWorkingTree` runs only on repo switch, manual ↺
   and stage/unstage clicks. An edit made by the shell, Claude or an editor leaves the rail *and the
   open diff* stale until a manual poke.
2. **PR fetch too long** — the fan-out runs `gh pr list --json …comments…` per repo; `comments` is
   full bodies. Measured on one repo: **4.9 s / 746 KB, 97% of it comment bodies** that `normalisePR`
   throws away keeping only the count — and it brushes exec's 1 MB default `maxBuffer`, where overflow
   is swallowed by `.catch(() => [])` and reads as "repo has no PRs". Nothing paints until the slowest
   of ~40 repos returns.
3. **New (untracked) file shows "No diff available"** — `git:file-diff` runs plain `git diff`, which
   outputs nothing for a file git isn't tracking (status `??`).

Measured dead ends, so a redo doesn't retry them: batching repos into one aliased GraphQL query 502s
at even 4 repos (GitHub's ~10 s gateway limit compounds per busy repo — elasticserver alone costs
~4.4 s server-side); PR-level `additions`/`deletions` cost ~1.6 s per busy repo but **are consumed**
(RepoSidebar tab badges), so they stay.

- [x] Main: single-slot recursive worktree watcher (`git:watch-working-tree` / `git:unwatch-working-tree`),
      `.git` churn filtered to index/HEAD/refs, 400 ms debounce → `git:working-tree-changed` push
      → verified: external write shows in the rail **509 ms** later, no ↺ click; delete drops the row in 509 ms
- [x] CentrePane: subscribe per repo; quiet rail reload (no Loading flash), silent in-place re-fetch of
      the open diff, branch chip refresh → verified: open diff gained the appended line **773 ms** after
      an external append, in place
- [x] Main: `prs:list` → per-repo `gh api graphql` (comment **count**, no bodies) mapped to the exact
      `GhPRNode` shape; remote-url discovery parallelised → verified live through IPC: mobile-edge in
      **2.7 s** (was 4.9 s), full field-shape assertion incl. `commentCount=7`, 6 rollup contexts
- [x] Main: `prs:hydrate` → one aliased GraphQL query per 20 refs, per-PR `gh pr view` fallback,
      partial-`data` salvage when one alias errors → verified: hydrated PR `===` fan-out PR by oid
- [x] usePRInbox: localStorage cache seeds first paint; PRsDrawer full spinner only when nothing cached
      → verified: cache written (348 PRs / 39 repos); a fresh renderer boot paints the count line in
      **2 ms** with no spinner while the fan-out re-runs behind it
- [x] Main: `git:file-diff` falls back to `git diff --no-index -- /dev/null <file>` for `??` files
      (exit 1 carries the diff on stdout; header parses with the existing `parseDiff`)
      → verified: untracked file renders add-hunks, "No diff available." absent
- [x] tsc: node clean, web at the 15-error baseline (all 15 in untouched files); `npm run build`;
      driver **11/11**

### Review

Six files: `electron/main/index.ts` (watcher + `git:file-diff` fallback + `PR_GQL_FIELDS`/`mapGqlPR`/
`ghGraphQL` + both PR handlers rewritten), `electron/preload/index.ts` + `src/hooks/useTerminal.ts`
(three watch APIs), `src/components/CentrePane.tsx` (subscribe effect, `quiet` reload, `wtTick` +
`diffKeyRef` stale-response guard), `src/hooks/usePRInbox.ts` (cache), `src/components/PRsDrawer.tsx`
(busy gate only).

Kept deliberately: PR-level `additions`/`deletions` (RepoSidebar tab badges consume them — do not
"optimise" them away, ~1.6 s/busy repo is their real cost); `PR_JSON_FIELDS` + `normalisePR` (the
hydrate fallback still speaks `gh pr view --json`); `.git` self-trigger loop is convergent because
`git status` only rewrites the index while stat cache is stale — the filter plus 400 ms debounce
absorbs the one echo.

Driver traps new to this session, both worth their line:
- **gh under a fake `HOME` is unauthenticated** — the token lives in the macOS keychain, not
  `hosts.yml`, and the keychain read fails with a redirected `HOME` ("token in default is invalid").
  Pass `GH_TOKEN=$(gh auth token)` into the launch env.
- **If the packaged app is running, a driven dev instance shares its userData** (`app.name` both
  "Flight Deck") **and the live app holds the localStorage leveldb lock** — the driven renderer gets
  in-memory storage that dies with the window, so "cache survives relaunch" silently reads as a cache
  bug. `page.reload()` re-runs the renderer's boot initialisers against the surviving storage and is
  the honest same-process equivalent. (State.json was safe — main-process paths follow `$HOME`;
  Chromium's userData does not.)
- Third occurrence of the rail-toggle trap: `tdash:sidebar-panel` persists, so after reload the PRs
  drawer restores **open** and a blind `railButton` click closes it. Probe before clicking.

## PR card — CI, comments, reviewer, draft (agreed spec 2026-07-30)

Three signals on the branch/sha row, plus the draft case. Layout supplied as a mockup; the prose is
the spec.

### Agreed layout

```
┌ ⑃ [DRAFT] Migrate ApiTokenCache to Caffeine mem cache          ● Draft ┐
│   Skedulo/mobile-edge-service#1448 · tungtranskedulo · Updated 3h ago  │
│  ┌ ⎇ feature/mob-515-migrate-apitok… ⎘ ┐ ┌ ◉ 83e288a ⎘ ┐   ✓  ▭3  (VB) │
└────────────────────────────────────────────────────────────────────────┘
                                                       CI  comments  reviewer
```

### Pinned rules

1. **CI reads first** — it decides whether the PR is reviewable at all. One icon carrying colour *and*
   shape: green ring-check passing, red ring-cross failing, amber clock running. Hover gives the count
   (`1 check failing`). Shape as well as colour, so it survives a colour-blind reader.
2. **Failing outranks running outranks passing.** `CheckRun` reports `conclusion` + `status`,
   `StatusContext` reports `state` — read `conclusion ?? state` and both collapse to the same verdict.
3. **No checks gets a dashed muted ring**, not an absent icon — the row must not reflow between cards.
4. Comment count is muted at 0 (`label4`) and brighter above (`label2`), so an active discussion is what
   the eye lands on and empty ones recede.
5. Reviewer is an initials circle: bot `purple`, person/team `teal`, all names on hover. **Unassigned is
   a dashed empty ring** — "nobody's on this" is itself a signal, not blank space.
6. `reviewerName` is `login ?? name ?? slug`. A Team's `slug` is org-qualified (`Skedulo/v3-backend-core`)
   and would initialise as `SB`; its `name` is the plain one.
7. **A draft never wears the orange call to action.** `DRAFT` tag beside the title, and the pill flips to
   a quiet grey `Draft`. Orange means *waiting on you*; a draft isn't.
8. `commentCount` is collapsed **in the main process**. `gh --json comments` returns full bodies — a
   single Linear linkback comment measured ~1.5 KB, so 100 PRs × N bodies would cross IPC for one number.
9. `commentCount` is optional on `GhPRNode`: PRs cached before the field existed replay without it.

**Done 2026-07-30.** Three files: `electron/main/index.ts` (`comments` in `PR_JSON_FIELDS`, shared
`normalisePR` collapsing it to a count on both the fan-out and hydration paths), `src/hooks/useTerminal.ts`
(`commentCount?`), `src/components/PRsDrawer.tsx` (`ciRollup` + `CIStatus`/`CommentCount`/`ReviewerAvatar`,
`ReviewPill` gains `isDraft`, pill moves to the title row).

Verified in two passes — **9/9** on the rollup logic across states the live data can't show, and
**18/18** under Playwright `_electron` against real PRs:

| Check | Result |
|---|---|
| Rollup, 9 cases | real #1448 (6 mixed CheckRun/StatusContext) → `6 checks passing`; real #1447 (one `FAILURE`) → `1 check failing`; queued/pending → running; failing outranks running; cancelled and timed-out count as failing; skipped and neutral count as passing |
| CI on screen | 6/6 cards; green check on passing, red cross on failing, different glyph *and* colour |
| Comment count | 6/6; number always matches the tooltip |
| Reviewer | 6/6; `VB` + `+1` for two reviewers with both names on hover; dashed empty ring on the unassigned draft |
| Draft | #1445 → `DRAFT` tag + achromatic `Draft` pill; every non-draft keeps orange `Review pending` |
| Type-check | `tsconfig.node.json` clean; `tsconfig.web.json` at the 15-error baseline, none in a touched file |

Not covered by the live run: **no PR on screen had 0 comments**, so the muted-at-0 branch of rule 4 is
untested against a real card. Likewise no `running` or `no checks` PR appeared — both are covered by the
rollup cases but not by a render.

Driver gotcha: **assert colour by hue relationship, never by literal `rgb()`.** Six assertions failed
on hardcoded Breeze-dark hex while the app was running a different theme — a pure test bug that reads
exactly like a product bug. `g > r && g > b` for green, `r > g && g > b` for orange, `max−min < 40` for
"achromatic, not a call to action"; those hold under every theme and test the meaning the spec asks for.

## Phase 2 — Sessions panel: agent/shell rows + PR cross-link (agreed spec 2026-07-30)

Approved: **lift PR state into Dashboard** for the `N need you` count, and a **PTY-idle heuristic** for
`needs input`. Both chosen over the cheaper alternatives — see the two decision notes below.

### Gap vs the Phase 2 line

| Spec | Before |
|---|---|
| AGENTS: dot, age / `needs input`, branch/ticket subtitle | dot ✓, age ✓, subtitle ✓ — **`needs input` never computed** |
| SHELLS: `⟳ branch` + working-tree ± | shared the agent renderer; `⎇` glyph |
| `Pull requests · N need you ›` row | missing entirely |
| Selecting a shell re-points the Terminal tab | already works (Phase 1 fix) — a regression guard, not new work |

`RepoSidebar`'s own `load()` was dead: it called `listPRs([...pinnedRepos])` off
`localStorage["tdash:pinned-repos"]`, which nothing has written since pin management was deleted, and
`prs:list` short-circuits to `[]` on an empty array (`electron/main/index.ts:2367`). So `prs` was
permanently empty, `loading` was set but never read, and the `#PR` badges came only from `tabPRCache`.

### Agreed layout

```
┌─ nav ──┬──────────── Sessions 264 ─────────────┐
│ 56     │ SESSIONS                            + │  34px panelHeader (unchanged)
│        ├───────────────────────────────────────┤
│ ◉ Sess │ ⑃ Pull requests · 1 need you         › │  32px cross-link row, rowState hover
│ ✎ File ├───────────────────────────────────────┤
│ ⑂ Git  │ AGENTS · 2                            │  sectionLabel
│ → PRs  │▏● mobile-edge-service              4m │  green dot + age
│ ✓ Task │▏  ⎇ MOB-396-token-cache         #1425 │  branch/ticket, CLIP_LEFT
│        │ ◐ terminal-dashboard      needs input │  orange dot + orange text
│        │   ⎇ cowork                            │
│        │ SHELLS · 3                            │
│        │ ○ phoenix                             │
│        │   ⟳ main                    +120 −8   │  ⟳ + working-tree ±
│        │ ○ knowledge-base                      │
│        │   ⟳ main                              │
└────────┴───────────────────────────────────────┘
```

### Pinned rules

1. Two renderers, not one: `renderAgentRow` (dot · name · **age / `needs input` / `3/7` / `done`**;
   line 2 = `⎇` branch + `#PR`) and `renderShellRow` (dot · name; line 2 = `⟳` branch + `+a −d`).
   The ± stats leave the agent row — 264px can't hold branch + ± + `#PR`, and an agent's diff belongs
   to the Changes rail.
2. Status slot, one value, in precedence order: `needs input` (orange) → age (green, running) →
   `3/7` → `done` → nothing.
3. The PR row is **not** the panel footer — Phase 6 reserves the footer for the status-bar mirror. It's
   the first row of the scroll list, so it doesn't move as sessions come and go.
4. It calls the same `openSidebarPanel("prs")` the nav rail uses — no new state.
5. Selection stays `rowState`. No new colours, no pills. Sentence case.
6. `isBranchTab` (dead before this change) stays untouched.

### Decision — `N need you` comes from Dashboard, not a second fetch

`needsYourReview` is only meaningful after the team narrowing *and* the Updated window, both of which
lived in `PRsDrawer`. A separate `gh search prs --review-requested=@me` count would have read 17 beside
the drawer's 1. So the inbox fan-out moves up: new `src/prs.ts` (pure domain — `categorizePR`,
`withinUpdatedWindow`, `teamMatchSet`, `UPDATED_WINDOWS`, typed on the existing `GhPRNode`, not a
second `PR` interface) plus `src/hooks/usePRInbox.ts` (the fetch + 5-min refresh). `Dashboard` calls the
hook once; `PRsDrawer` becomes a consumer, `updatedWithin` joining `width` as a controlled prop.

Falls out of it: the ~9s refetch on every PRs-panel toggle is gone (the drawer no longer owns the
fetch), `RepoSidebar`'s dead `load()`/`prs`/`loading`/`pinnedRepos` go, and `tabPRCache`'s per-repo
`listPRs([repo])` goes too — the shared fan-out already covers every local repo at `--limit 100`.

### Decision — `needs input` is a PTY-idle heuristic

No signal existed. The Claude Code `Notification` hook would be exact but needs an edit to
`~/.claude/settings.json`, so it only works on a configured machine. Main already sees every PTY chunk,
so it stamps `lastDataAt` per session and exposes it; the renderer polls while any agent is open:

- `running` — output within 3s
- `needs-input` — silent ≥10s **and** the panel's task summary still has `inProgress > 0`
- `idle` — otherwise

Deliberate limits: an agent with no task list never reads as `needs input` (no `inProgress` to gate on),
and a long silent build inside an agent session reads as `needs input` too. Both are acceptable — the
gate keeps it from firing on every idle shell, which is the failure that would make the dot noise.

**Done 2026-07-30.** Seven files: `electron/main/index.ts` (`sessionLastData` map stamped in
`queueOutput` — the single choke point both `onData` paths go through — cleared in `onExit`, exposed as
`terminal:get-activity` keyed by panel number), `electron/preload/index.ts` + `useTerminal.ts`
(`getActivity`), `src/prs.ts` **new** (domain moved out of the drawer, plus `bucketPRs` so the count and
the sections bucket once, identically), `src/hooks/usePRInbox.ts` **new** (fan-out + 5-min refresh +
`ghLogin`/`myTeams`/`updatedWithin`), `PRsDrawer.tsx` (−~120 lines, now a consumer; `load()` keeps only
the search-cache drop), `RepoSidebar.tsx` (PR cross-link row, activity poll, `renderRow(tab, kind)`),
`Dashboard.tsx` (`usePRInbox` once; `modalRepos` and `needYouCount` derived from it).

Verified under Playwright `_electron` across three driver runs — all mockup assertions hold:

- Cross-link row renders `⑃ Pull requests · 1 need you ›`; clicking it opens the PRs panel.
- Agent row second line `⎇ cowork`; shell row `⟳ cowork  +254 −232`. `prBadges` empty on shells,
  `diffBadges` empty on agents — the kind gate holds both ways.
- `needs input` fires: row 1 read `2d` green `rgb(110,191,129)` at ~15s, then `needs input` orange
  `rgb(233,145,73)` at ~35s once the PTY had been silent past `SILENT_MS` with `inProgress > 0`.
- Regression guard passes — clicking a session row re-points the Terminal tab (`>_ terminal-dashboard`
  → `>_ ~`).
- `tsconfig.node.json` clean; `tsconfig.web.json` at the 15-error baseline, none in a touched file
  (proven by stashing `src` + `electron` and re-running, which also gives 15).

Deviation from pinned rule 1: **one `renderRow(tab, kind)`, not two renderers.** Two would have been two
copies of the row frame for a two-span difference; `kind` gates only the second line's icon and trailing
badge. Everything else in the rule (± off the agent row, `#PR` off the shell row) holds as written.

Three things worth keeping:
- **The `+` button opens the directory picker, not a panel.** A driver that clicks it and then calls
  `writeToFocusedTerminal` types into the *previously* focused panel and the modal backdrop swallows
  every later click — reads as three unrelated failures. Drive it: type, `Enter` to navigate, `⌘Enter`
  to open.
- **A restored panel starts at `~` with no branch**, so neither second-line icon renders until something
  `cd`s it. Verifying the two shapes needs a repo-rooted panel, not just a launch.
- **`terminal:get-activity` errors in replayed scrollback are stale history**, not a live failure — the
  log predates the rebuild. `needs input` firing at all is the proof the handler is registered, since
  that branch needs a non-null `lastData`.

## Phase 3 — Files panel: repo header + branch chip (agreed spec 2026-07-30)

Approved: **drop the `×`** to make room for the chip. Chosen over sacrificing global search or adding a
second header row.

### Gap vs the Phase 3 line

| Spec | Before |
|---|---|
| Port `FileTreeModal` into the sidebar | already hosted (`Dashboard.tsx:910`), same slot as Sessions/PRs/Tasks — "Modal" is a leftover name |
| `In files │ Filenames` segmented control | already there (`FileTreeModal.tsx:509`) |
| Content search via grep IPC | `repo:grep-matches` exists (`electron/main/index.ts:2579`) — no new IPC |
| Picking a file adds the `</> name` tab and switches | already works (`CentrePane.tsx:542` + switch effect at `:167`) — a regression guard, not new work |
| **Repo header + branch chip** | **missing — the branch appears nowhere in the panel** |

Same shape as Phase 2: most of the line was already standing, one thing genuinely absent.

### Agreed layout

```
┌─ nav ──┬──────────────── Files 260 ─────────────────┐
│ 56     │ terminal-dashboard   ⟳ cowork    🌐 📁 ⇄  │  34px panelHeader, title CLIP
│        ├────────────────────────────────────────────┤
│ ◉ Sess │ 🔍 Search filenames…                       │  26px query field  (unchanged)
│ ✎ File │ [In files│Filenames]  Aa  .*               │  20px control row  (unchanged)
│ ⑂ Git  ├────────────────────────────────────────────┤
│ → PRs  │ ▾ src                                      │
│ ✓ Task │   ▾ components                             │
│        │     </> CentrePane.tsx                     │
└────────┴────────────────────────────────────────────┘

search state — the chip slot swaps, it does not stack:
│ Search              40 files       🌐 📁 ⇄        │
```

### Pinned rules

1. Branch chip is `chip(t, "neutral")` with the `⟳` glyph — the same glyph Phase 2 gave shell rows for a
   working tree, so one glyph keeps one meaning. Not `⎇`; Phase 2 reserved that for an agent's branch.
2. **One chip slot.** Browse → `⟳ branch`; search → `N files`. Never both — 260px won't hold two chips
   plus three icons.
3. Drop the `×`. Sessions has no close button and the nav rail already toggles the panel. Escape in the
   filter field still closes (`FileTreeModal.tsx:475`) — only the chrome goes, the keyboard path stays.
4. No branch for a non-repo root (`~`, an arbitrary folder) → chip absent, not `—`. `getRepoBranch`
   returns null there.
5. Refetch on root change only, mirroring `CentrePane.tsx:184`. No polling — a live branch belongs in
   Phase 6's status bar.
6. Everything below the header is untouched: tree, segmented control, grep, global search, result
   grouping, ↑↓ nav.
7. Filename stays `FileTreeModal.tsx`. Phase 2 left `RepoSidebar.tsx` unrenamed despite the todo calling
   it `SessionsPanel`; renames are Phase 7 sweep work.

**Done 2026-07-30.** Two files: `src/components/FileTreeModal.tsx` (`branch` state + refetch effect
keyed on `repoName`, guarded by `rootRef` like the existing tree fetch; chip in the header; `×` removed)
and `electron/main/index.ts` (`git:current-branch` now resolves through `resolveRoot`).

The main-process line was not optional. `git:current-branch` did `join(githubDir, repoName)`, which for
an absolute root produces `…/GitHub/Users/tungtran/…` — a path that throws, caught, returned null. The
panel explicitly supports absolute roots via `onPickRoot`, so every folder browsed that way would have
shown no branch. `resolveRoot` was already sitting at `:2451` doing exactly this for the six `repoOrPath`
handlers; the change is strictly more permissive, since a bare repo name resolves identically.

Verified under Playwright `_electron`:

| Check | Result |
|---|---|
| Browse header | `TERMINAL-DASHBOARD` + chip `⟳ cowork`, buttons `[svg, svg, ⇄]` — no `×` |
| Search header | `SEARCH` + chip `1 files`, same three buttons — branch chip yields the slot |
| `</> name` tab (regression guard) | `</> Dashboard.tsx ×` active in the centre strip, body rendered |
| Rule 4, all four root shapes | `terminal-dashboard`→`cowork`, `~`→null, `/…/knowledge-base`→`main`, `/etc`→null |
| Type-check | `tsconfig.node.json` clean; `tsconfig.web.json` at the 15-error baseline, none in a touched file |

Driver gotchas, both costing a run:
- **The nav rail items are `<button title="…">`, not divs.** `div:text-is("Files")` times out with no
  pointer-event message, so it reads as the panel being missing. Use `button[title="File tree and search"]`.
- **Descending from the panel root finds the scroll container, not the header.** `panels[last]` matching
  on width+height latches onto the inner list, whose children are the 26px tree rows — the probe then
  reports "no header" for a header that is on screen. Match the ~35px band globally by geometry instead
  (34px `height` + 1px border = 35 in `getBoundingClientRect`, so a `=== 34` test never fires).

## Phase 6 — status bar + sidebar footer mirror (agreed spec 2026-07-30)

### Gap vs the Phase 6 line

A status bar already existed; it carried half the spec and used the wrong branch glyph.

| Spec item | Before |
|---|---|
| `⟳ branch` | present but drawn with `⎇` — Phase 2 pinned `⎇` to *agent* branches |
| `N changed` | already shipped |
| `↑N ↓N` ahead/behind | already shipped — not in the spec, kept |
| `N open PRs` | **missing** |
| `N need you` | **missing** from the bar (the Sessions cross-link had it) |
| `● synced Xm` | **missing** — `lastRefreshed` existed in `usePRInbox`, was never rendered |
| sidebar footer mirrors it | **missing entirely** — `RepoSidebar` had no footer |

Every input was already in `Dashboard`, including the 30s `setStatusTick` whose own comment said it
existed to keep a sync-freshness label current. Phase 6 is what that tick was written for.

### Agreed layout

```
bar     ⟳ cowork · 12 changed ················· 6 open PRs · 1 need you · ● synced now   26px
footer  ⟳ cowork · 12 changed                                                            two rows,
        6 open PRs · 1 need you · ● synced now                                           43px total
```

Bar pushes the two groups apart with a flex spacer; the footer stacks them because 264px cannot hold
the line honestly (~310px at 11px mono). Same segments, same order, same colours either way.

### Pinned rules

1. **One component, two mount points.** `StatusStrip` with `layout="bar" | "footer"`. "Mirrors" is
   then structural — there is no second copy of the strings to drift.
2. `⟳` is a working tree's branch, `⎇` is an agent's branch. Phase 2's rule; the bar was violating it.
3. **The glyph must sit outside the `CLIP_LEFT` span.** `CLIP_LEFT` is `direction: rtl`, which
   reorders a leading neutral glyph to the far end — nested, the branch renders `cowork ⟳`.
4. `open` is the **bucket sum**, not `prs.length`, so the strip and the PRs panel header can never
   quote different totals. One `bucketPRs` call feeds both readouts.
5. `0 need you` is hidden, matching the Sessions cross-link's existing rule.
6. Counts are suppressed entirely while `loading` — the dot carries the state until they're honest.
7. The sync dot is state, not decoration: green settled, amber syncing, red failed; `title` names the
   exact refresh time.

**Done** — `src/components/StatusStrip.tsx` (new, 119 lines); `Dashboard.tsx` replaced its 28-line
inline bar with `<StatusStrip layout="bar">` and swapped `needYouCount` for a single `prCounts` memo;
`RepoSidebar.tsx` mounts `<StatusStrip layout="footer">` and now imports `shortAgo` from it rather
than keeping a second copy.

### Verification

`npx tsc --noEmit` on both projects; web stayed at its 15-error baseline (measured by stashing the two
edits and re-counting — 15 before, 15 after). `drive-p6.mjs`, 24/24:

| Group | Assertions |
|---|---|
| Both strips exist, footer spans the sidebar column exactly | 3 |
| Footer text `===` bar text (no-repo state **and** repo-focused state) | 2 |
| Bar is one 26px row, footer stacks two | 1 |
| `⟳` used, `⎇` absent, glyph renders left of the branch | 2 |
| `N changed` / `N open PRs` / `synced Xm` / `·` separators / plural agreement | 5 |
| Sync dot green when settled, same colour in both strips, exact time on hover | 3 |
| `need you` matches the Sessions cross-link; `0` hidden | 2 |
| `open PRs` equals the PRs panel's own header total | 1 |
| Bar survives a sidebar panel switch; branch full name on hover; `No repo` gives way | 3 |
| A session exists to focus; repo + PR groups both present | 2 |

### Driver gotchas

- **`innerText` returns logical order, so it cannot see rtl reordering.** The `cowork ⟳` bug passed
  every text assertion; only the screenshot caught it. The regression check compares the glyph span's
  `getBoundingClientRect().x` against the branch span's.
- **The sidebar starts at x=56, not 0** — there's a nav rail to its left. Locating the 264px column by
  width was brittle; the `Pull requests` cross-link is `width: 100%` of the same column and makes a
  reliable width witness.
- **Restored PTYs respawn in `~`**, so no amount of clicking session rows produces a focused repo —
  the rows show a repo *title* while their `cwd` is still home. The driver types a real `cd` and lets
  the OSC 9999 hook drive `cwd → focusedRepo → getRepoStatus`. Without it, three assertions were green
  over an absent case.
- `sips -c` mangled the crop; use Playwright's `screenshot({ clip })`.

## Phase 5 — ChangesRail v2 + diff polish (agreed spec 2026-07-30)

### Gap vs the Phase 5 line

Four of the five spec items had already landed in earlier phases. Only the hunk nav was genuinely
missing — the same shape as Phases 2 and 3.

| Spec | Before |
|---|---|
| `Working tree +a −d · Commits` switcher row | already shipped (`CentrePane.tsx:398`) |
| Two-line file rows: status square, path subtitle, ± + 5-box stat | already shipped (`DiffFileRow` in `DiffKit.tsx`) |
| Sticky Stage all / Discard footer | already shipped |
| Blue hunk-header band | already shipped (`DiffChunks`) |
| Breadcrumb `+a −d ⌃ ⌄` hunk nav | **missing entirely** |

### Agreed layout

```
┌ …/src/components/CentrePane.tsx      +11 −4   ⌃ 3/5 ⌄ ┐  28px header, nav flex-end
├───────────────────────────────────────────────────────┤
│ @@ -712,6 +712,9 @@                                   │  blue band = a [data-hunk] anchor
│ + …                                                   │
```

### Pinned rules

1. **One `HunkNav`, three call sites.** Working tree, PR file and commit diffs already share the shape
   "28px header row above an `overflowY: auto` container", so one component serves all three rather
   than the working tree alone.
2. **One shared `diffScrollRef`.** The three bodies are mutually exclusive, and `HunkNav` only reads the
   ref inside `requestAnimationFrame` or an event handler — never during render.
3. **The counter is derived from scroll position, never set optimistically.** `go()` scrolls, then
   `sync()` re-reads `scrollTop`. A clamped or impossible jump must not leave the counter claiming a
   hunk you aren't on.
4. Counter sits *between* the chevrons (`⌃ 3/5 ⌄`), so the group reads as one control.
5. Chevrons are **disabled, not hidden**, at each end — hiding shifts the group's width as you walk.
6. **The whole group hides when the diff doesn't overflow.** A dead pair of chevrons reads as broken.
7. Hunk offsets come from DOM measurement (`[data-hunk]`), not from counting parsed chunks — line
   heights vary with wrapping and the band's own borders.

**Done 2026-07-30.** Two files: `src/components/DiffKit.tsx` (`data-hunk` marker on the hunk header;
new `HunkNav`) and `src/components/CentrePane.tsx` (shared `diffScrollRef` + `<HunkNav>` in all three
diff headers).

Two things beyond the spec, both real defects the driver caught:
- **Optimistic counter.** The first cut called `setIndex(next)` before scrolling, so the counter read
  `3/5` with hunk 1 still at the top. Rule 3 exists because of this.
- **No remeasure on resize.** `scrollable` was only computed on `resetKey` change, so resizing a panel
  could leave the chevrons visible with nothing to walk. A `ResizeObserver` on the scroll container
  fixes it; offsets survive the resize untouched because diff lines are `white-space: pre` and never
  rewrap.

Verified under Playwright `_electron` at 1700×640 — **20 assertions, 0 failures**:

| Check | Result |
|---|---|
| Rail counts vs `git status --porcelain` | 3 unstaged / 0 staged, `Working tree +93 −6 · Commits` — matches |
| Counter N vs `git diff \| grep -c '^@@'` | `1/5` for CentrePane, `1/2` for DiffKit — both match |
| Chevrons walk | `0 → 139 → 308`, prev returns to `139` exactly |
| Hand-scroll to bottom | pins `5/5`, next disabled |
| Both ends | prev disabled at `1/N`, next disabled at `N/N` |
| Resize (rule 6) | 508 client / 845 scroll → nav shown; grown to 1068/1068 → nav gone |
| Type-check | `tsconfig.node.json` clean; `tsconfig.web.json` at the 15-error baseline, none in a touched file |

Driver gotchas, both costing a run:
- **`railButton("git", …)` is a toggle, not a switch** (`Dashboard.tsx:626` is `setGitOpen((v) => !v)`).
  Clicking it when `gitOpen` is already true from persisted state turns the rail *off*, and the run
  then reports the panel as missing. Read `aria-pressed` first and only click when it isn't `"true"`.
- **`sectionLabel(t)` sets `textTransform: "uppercase"`**, so `innerText` reads `STAGED`, not `Staged`.
  A locator built from the source string finds nothing.
- Walking up for the scroll container by `el.scrollHeight <= el.clientHeight` never terminates —
  `documentElement.parentElement` is null and the loop falls out with `el === null`. Walk by
  `getComputedStyle(el).overflowY !== "auto"` instead.
- At a 1000px-tall viewport nothing overflows, so the walk is untestable. Shrink to 640.

## PR diff docks in the centre pane, not a fourth column (agreed spec 2026-07-30)

Approved: **centre-pane tab** — the PR review becomes a tab beside the shell, exactly like the
working-tree diff. Never a fourth column.

### The bug

`DiffDrawer` mounted as a **sibling column** of `CentrePane`, so with the PRs panel open the window ran
out of room. Measured at 1400px:

| | nav | PRs | terminal | diff | rail |
|---|---|---|---|---|---|
| Git + terminal (the reference) | 56 | 480 | **624** | — | Changes 240 |
| After ± Diff (broken) | 56 | 480 | **224** | 400 | Files 240 |

The terminal collapsed to a 224px sliver — paths wrapped mid-word — and the Changes rail vanished
(`showRail={gitOpen && !selectedPR}`). Four columns don't fit. Raising Branch diff's floor to
`RAIL_W + 400` in the redesign above deepened it from ~327px to 224px, but the squeeze is structural.

### Why this collapses to a small change

`CentrePane` already **is** this screen: `paneTab` (`terminal` · `viewer` · `file`), a
`railView: "working-tree" | "commits"` switch, a breadcrumb row, and `DiffChunks`. And the IPC is
already shared — `getCommits(repo, branch, prNumber)` takes the PR number as a third argument, and
`getCommitDiff` is identical. So the PR review is **a third rail view**, not a port.

### Agreed layout

```
┌nav┬── PRs 480 ────┬──────── centre 864 ─────────────┐
│56 │ Pull requests │ >_ shell │ #1425 ⌥ │  FILES 240 │  34px tab strip + rail header
│   │ ┌ MOB-396 ──┐ │ ─────────┴─────────┼────────────│
│   │ │  ± Diff   │ │ ▤ mobile-edge/…    │ 8 files    │  28px breadcrumb + 30px summary
│   │ └───────────┘ │ @@ -21,6 +21,8 @@  │▏libs.…toml │  rowState
│   │               │ +  resilience4j…   │  build.…   │
└───┴───────────────┴────────────────────┴────────────┘
```

### Pinned rules

1. `CentrePane` gains `prReview?: { repoName, prNumber, prTitle, prUrl, headRefName, onClose }`.
   `railView` gains `"pr-files"`; `prMode = railView === "pr-files" && selectedPrFileIdx != null`.
2. New state is five items only: `prFiles`, `prFilesLoading`, `selectedPrFileIdx`, `prFilesTick`
   (refresh needs its own trigger — see the `setSelectedCommitHash` no-op trap below), plus `prReview`'s
   own reset effect.
3. `prRepo = prReview?.repoName ?? repoName` everywhere in PR mode — **a PR can live in a repo other
   than the focused terminal's**, so breadcrumb, `openRepoFile` and `getCommitDiff` must not use `repoName`.
4. The repo-switch reset effect (`useEffect(…, [repoName])`) must **not** clear the PR view — an
   unrelated `cd` in the terminal cannot close a PR the user is reading.
5. The commits rail serves both: with `prReview` set it fetches `(prRepo, headRefName, prNumber)` and its
   back-link reads `← Branch diff`; otherwise `(repoName, currentBranch)` and `← Working tree`.
   **Deviation from the mockup, deliberate:** Branch diff ⇄ Commits reuses this existing back-link idiom
   rather than a new segmented control — it's the pattern already in this rail, and a second switcher
   style would be the same drift this whole task is undoing.
6. Pane tab in PR mode: `#1425` blue mono badge + selected filename + `±` stats + `×` (calls `onClose`).
7. `renderDiffFileRow` moves out of `DiffDrawer` into `DiffKit` as `DiffFileRow`, owning its own hover
   state — so `CentrePane`'s PR rail and `DiffDrawer`'s rail share one row, and two hover states go away.
8. `Dashboard`: `showRail={gitOpen || !!selectedPR}` (a PR must be able to show its rail with the git
   toggle off), pass `prReview`, drop the `DiffDrawer` sibling render + the now-unused `diffWidth`.
   **`DiffDrawer.tsx` becomes unmounted** — flag it, don't delete it.

**Done 2026-07-30.** Four files: `CentrePane.tsx` (+~210 lines — `prReview` prop, `PRReview` interface,
`"pr-files"` rail view, five state items, three effects, PR pane tab, PR diff body, PR rail branch,
`paneActionFile`), `DiffKit.tsx` (`DiffFileRow` extracted, owns its hover), `DiffDrawer.tsx`
(`renderDiffFileRow` + `diffHovered` deleted), `Dashboard.tsx` (rewired; drawer render + import +
`diffWidth` gone). Measured at 1400×900: **56 + 480 + 864, unchanged by opening a PR** (was
56 + 480 + 224 + 640), terminal pane back to **624px**, `FILES` rail 240px at x=1160 *inside* the
centre column. Driver: all PR-review checks pass, including `Commits →` loading the PR's 2 commits and
`← Branch diff` returning.

Three things that each cost a cycle:
- **`SelectedPR` carries `branch`, not `headRefName`** — a `{...selectedPR}` spread type-checks and
  silently drops the head ref, breaking both the branch chip and the PR-commits fetch. Map the six
  fields explicitly.
- **`panelTitle` caps come from `textTransform`**, so a driver probe for `"CHANGES"` finds nothing,
  falls through to its fallback, and clicks Git *off* — the first BEFORE measurement was wrong because
  of this, not because of the app.
- **A selected commit renders its whole diff** (per-file headers inline) and the rail stays on the
  commits list — there is no commit→file selection step in `CentrePane`, unlike the old drawer. Both
  driver scripts asserted the drawer's behaviour and failed against correct code.

Still open, deliberately untouched: `DiffDrawer.tsx` (1367 lines) is now **unmounted dead code**, and
`ChangeBar` in `DiffKit.tsx:136` is unused. Neither deleted — needs a call.

## Branch diff + Commits tabs — adopt the working-tree design (agreed spec 2026-07-30)

Approved: rail on the **right** (matches Working tree, so it never jumps sides), and **both** tabs via
one shared row renderer.

The **Working tree** tab was redesigned (see "Git changes UI redesign" below); **Branch diff** and
**Commits** were not, so the same drawer now shows two visual languages. `DiffChunks` (the diff body
itself) is already shared and already toned down — only the chrome around it is stale.

### What's actually stale

| | Working tree (new) | Branch diff / Commits (old) |
|---|---|---|
| File list side | rail on the **right**, `panel(t, "left")`, `RAIL_W` 240 | list on the **left**, hard-coded 220 |
| Rail header | `panelHeader` + `panelTitle` (34px, 10px caps) | none — a raw-rgba summary strip |
| Selection | `rowState` (fill + 2px inset left bar) | `borderLeft: 3px solid statusColor` + raw rgba fill |
| Diffstat | `StatBlocks` (5 boxes) | `ChangeBar` (52px split bar) |
| Surfaces | `t.surface0` / `t.surface2` / `t.borderSubtle` | `rgba(255,255,255,0.02)` ×5 |
| Type scale | 12 / 11 / 10 | 11 / 10 / 9 |
| Radii | `RADIUS_SM` token | `borderRadius: 3` hard-coded |
| File header | 28px breadcrumb + `RepoGlyph` + copy/open glyphs | one raw-rgba strip, no actions |

Branch diff rows (`DiffDrawer.tsx:628-680`) and Commits-detail rows (`:951-1003`) are near-identical
copies of the same old row — so the fix is **one shared renderer**, not two edits.

### Agreed layout

```
┌─ flex ────────────────────────────────────────────┬─ RAIL_W 240 ───────┐
│ TokenCache.kt  +50 −2                     ⧉   ↗   │ FILES   MOB-354 ↻ ↗│  34px panelHeader
├───────────────────────────────────────────────────┼────────────────────┤
│ ▤ mobile-edge / src / main / kotlin        +50 −2  │ 20 files  +336 −31 │  28px / 30px
├───────────────────────────────────────────────────┼────────────────────┤
│ @@ -14,6 +14,11 @@                                │▏A TokenCache.kt    │  rowState
│ +   val cache = TokenCache()                      │▏  /main/kotlin/    │
│     …                                             │▏  +50 −2  ▪▪▪▪▫    │  StatBlocks
│                                                   ├────────────────────┤
│                                                   │ M build.gradle.kts │
└───────────────────────────────────────────────────┴────────────────────┘
```

### Pinned rules

1. Rail on the **right** at `RAIL_W`, so switching drawer tabs never shifts the layout sideways.
2. One `renderDiffFileRow(file, selected, onSelect)` shared by Branch diff and Commits detail.
3. Selection is `rowState` only — no coloured left border, no raw rgba.
4. `StatBlocks`, not `ChangeBar`. `ChangeBar` becomes dead but stays (no unasked deletions).
5. The raw-rgba `↗ Open in GitHub` footer goes; it becomes an `OpenGlyph` in the rail header, matching
   the working-tree rail's `RefreshGlyph`.
6. Left pane gets the working-tree file pane exactly: one active `paneTabStyle` tab + copy/open glyphs,
   then the 28px breadcrumb bar. **No** session/viewer pane tabs — `flightDeck` is false with a
   `prNumber`, so Dashboard already docks those itself and a second strip would duplicate the drawer's
   own tab bar.
7. `minWidth` floor extends to these tabs: `activeTab === "commits" && !selectedCommitHash ? 280 : RAIL_W + 400`.
8. `DiffChunks` untouched — diff body colour was already settled by "Diff colour — tone the wash down".

**Done 2026-07-30.** Only `DiffDrawer.tsx` changed (1342 → ~1160 lines): three shared helpers
(`renderDiffFileRow` / `renderFileRail` / `renderDiffPane`) replaced the two copy-paste file lists, so
Branch diff went 146 → 30 lines and Commits detail ~100 → 15. Plus the commits *list* row hover moved
onto `rowState`, 2 × raw-rgba → `t.surface0`, 4 × `borderRadius: 3` → `RADIUS`.

Four traps worth remembering:

- `onRefresh: () => setSelectedCommitHash(selectedCommitHash)` is a **React no-op** — same value bails
  out, so the rail's refresh button did nothing. Needed its own `commitDiffTick` counter in the effect deps.
- **TDZ**: the new `minWidth` floor reads `selectedCommitHash`, which was declared ~100 lines below it.
  Hoisted the `useState` above the resize block.
- `gh pr diff` takes **1.28s** — the driver's 700ms wait was probing the pre-load rail, which read as
  seven design regressions (`rows: 0`, `statBlocks: 0`, `hunkX: null`). Wait is now 4000ms. Also: a
  commit opens with *no* file selected, so the driver must click a rail row before the pane has a body.
- The old `± Diff opens the DiffDrawer` check only ever passed **vacuously** — with the diff unloaded the
  tab's `textContent` is exactly `"Branch diff"`; once loaded the count badge makes it `"Branch diff8"`
  and `getByText(exact)` dies. Now a `/^Branch diff/` prefix match.

Verified: `tsconfig.node.json` clean; `tsconfig.web.json` at the 15-error baseline (same 3 DiffDrawer
errors, line-shifted only — confirmed by stashing just that file); `npm run build` OK; driver **all
checks passed**, including 12 new ones asserting rail geometry (`railX=1160` > `hunkX=761`, `railW=240`),
`rgb(0,140,255) 2px inset` with `borderLeftWidth: 0px`, 40 StatBlocks / 0 ChangeBars, `minWidth: 640px`,
no rgba footer, copy/open actions present, breadcrumb glyph — for **both** tabs.

`ChangeBar` in `DiffKit.tsx:136-149` is now unused everywhere. Left in place per rule 4.

## Remove the Repositories section from the Sessions sidebar

Sidebar's Repositories block (PR tracking/browsing, "NOT TRACKING" list, clone-by-URL) was ~870 lines
entangled with Sessions above it and superseded by the standalone `PRsDrawer`. Four capabilities that
existed only there were resolved directly with the user: in-app PR diff → migrated into `PRsDrawer`;
clone-by-URL modal → dropped entirely; branch-checkout picker → migrated into the shell strip
(`CentrePane`); footer's "N open PRs · M repos · synced" summary → removed.

- [x] `RepoSidebar.tsx` — gut the Repositories section down to Sessions-only; `prs`/`repoTabStats`/
      `tabPRCache` (feed the tab +adds/-dels and #PR badges) preserved intact; props trimmed to
      tabs/focus/close/add/onReposLoaded → verify: sidebar renders Sessions only, badges still populate
- [x] `PRsDrawer.tsx` — relocated `SelectedPR` here; added "± Diff" action button wired to `onSelectPR`
      → verify: opens the existing `DiffDrawer` wiring in `Dashboard`
- [x] `CentrePane.tsx` — shell-strip branch chip is now clickable; new `BranchPicker` (search + arrow-key
      nav + checkout), fed by `localBranches`/`onCheckoutBranch` props → verify: dropdown opens under the
      chip, checkout shells out `cd && git checkout`
- [x] `Dashboard.tsx` — rewired all 4 call sites; added `localBranches` state + `listLocalBranches()`
      effect; removed `sidebarSummary`/footer PR-count row and the now-dead `selectedRepoTree`/
      `sinceLabel` (orphaned by the prop removals) → verify: tsc, build, Playwright driver all pass
- [x] `npx tsc --noEmit -p tsconfig.web.json` — 21 errors (down from the 28-error baseline), none
      introduced by this change; `tsconfig.node.json` clean
- [x] `npm run build && node drive.mjs` — all checks pass (one environment-driven `SKIP` on the PR-diff
      check: no PRs loaded in this sandbox); screenshots confirm the sidebar is Sessions-only at full
      column height and the branch-checkout dropdown renders correctly under the shell-strip chip

## PRs drawer — GitHub's five views (agreed spec 2026-07-30)

Approved layout: a **view dropdown chip** beside the Updated chip, reusing the dropdown primitive from
the Updated filter. Not segmented tabs (5 tabs in 480px truncates "Review requests") and not an icon
rail (a second rail beside the app's own nav rail).

```
┌─────────────────────────────────────────┐
│ Pull requests                     ↺   ✕ │
│ 6 PRs · 39 local repos · 01:56 PM       │
├─────────────────────────────────────────┤
│ ⊞ Inbox ▾    ◷ Updated: Last 3 mo ▾     │
│ ┌──────────────────────┐                │
│ │ ✓ Inbox            6 │                │
│ │   Authored by me   3 │                │
│ │   Assigned to me   0 │                │
│ │   Involves me      6 │                │
│ │   Review requests 17 │                │
│ └──────────────────────┘                │
├─────────────────────────────────────────┤
│ ▾ Needs your review                  1  │
```

Measured reality that drove the design (open PRs, this user, 2026-07-30):

| View | Real | Local fan-out can serve it? |
|---|---|---|
| Inbox | 6 | ✓ already built (6 sections) |
| Authored by me | 3 | ✓ `author.login === ghLogin` |
| Assigned to me | 0 | ✓ (needs `assignees`) |
| Review requests | 17 | ⚠ only **14** — 3 live in `notification-service`/`sms-notification-service`, not cloned |
| Involves me | 6 | ✗ **impossible** — e.g. `mobile-edge-service#1447` has no assignee and only a *team* review request, so the match is via **comments** |

**Architecture — search returns identity only, repo endpoints return data.** `gh search prs --json` has
no `headRefName`/`headRefOid`/`reviewDecision`/`statusCheckRollup`/`additions`/`deletions`, so
search-sourced rows could not render the branch chip, sha, CI badge or the Terminal / ± Diff buttons.
So: one `gh search prs` per view returns `{nameWithOwner, number}` refs; the renderer satisfies refs
from the existing fan-out cache and hydrates only the misses via `gh pr view` using the **same field
list** as the fan-out, keeping cached and hydrated PRs interchangeable. Verified `gh pr view` returns
that full field set for `notification-service#96` — a repo with no local clone.

Rules pinned so a later refactor doesn't undo them:
- **Inbox never touches search.** Only the four other views do, and only on first entry or after ↺.
- **The 5-minute auto-refresh never searches** — it refreshes the Inbox fan-out only.
- **No `--updated` passed to search.** Hydrate everything (≤100, realistically ≤20) and reuse the
  existing client-side `withinUpdatedWindow`, so the window toggle stays instant on all five views and
  each view costs exactly one search per refresh.
- **Qualifiers as gh flags, never a raw query string** — `gh search prs -- "a:b c:d"` quotes the whole
  string as one term. Use `--author=@me` / `--assignee=@me` / `--involves=@me` / `--review-requested=@me`.
- **Never `.catch(() => [])` on a search call** — that is exactly what hid the 403 secondary-rate-limit
  failure last time. Surface it as an inline error with a retry.
- **View choice is deliberately not persisted** — the drawer always opens on Inbox, so mount fires zero
  search calls.
- Non-inbox views render a flat list sorted `updatedAt` desc (GitHub's `sort:updated-desc`), no sections.
- Open/Closed toggle **deferred** by decision — everything stays `--state open`.

**Done 2026-07-30.** Touched `electron/main/index.ts` (`PR_JSON_FIELDS` extracted and shared, new
`prs:search-refs` + `prs:hydrate`), `electron/preload/index.ts`, `src/hooks/useTerminal.ts` (the 19-field
PR literal extracted to an exported `GhPRNode` so `listPRs` and `hydratePRs` can't drift), and
`src/components/PRsDrawer.tsx`. Both dropdowns were re-anchored into their own `position: relative`
wrappers — they had both been pinned at `left: 14`, which only looked right while Updated was the only
chip. Menu counts show an en dash until a view's first search resolves, so an unloaded view never reads
as an empty one.

Verified: tsc clean on both projects (15 web errors = pre-existing baseline, none in touched files);
`npm run build`; **74/74** driver checks live against the real account, including per-view assertions
that each search-backed view resolves with no 403, renders a flat list, drops the "local repos" clause,
and has a header count equal to the cards rendered.

Live numbers, and the one trap worth remembering: at the 3-month default the views read 1 / 0 / 4 / 5,
*not* the 3 / 0 / 6 / 17 measured against the API — because the window applies to every view. Widening
to "Any time" gives **17**, matching GitHub's `review-requested:@me` exactly, and only then do
`notification-service#95/#96` and `sms-notification-service#96` appear: all three were last updated in
early 2024, so the default window legitimately hides them. A driver assertion that expected them at the
3-month default failed and was wrong, not the code — confirmed against the API before touching it.
That widening also doubles as the test that the window stays client-side: 5 → 17 cards inside a 250ms
budget, which a re-issued search could not meet.

## App shell v3 — switchable sidebar panels + permanent tabbed centre (mockups 2026-07-29)

Target: `[nav 64][sidebar panel 320][centre tabs, flex ≥480][CHANGES rail 320]`. Rail switches the
sidebar panel (Sessions · Files · Git · PRs · Tasks + avatar); terminal exists only as the centre
`>_ Terminal` tab; CHANGES rail is persistent (Git item toggles it). Decisions: Notes/Stats/History/
Claude/KB stay as overlay drawers via ⌘P + ⌘⇧ shortcuts (off the rail); **Broadcast removed
entirely**; terminal dock/stacked/even-split layouts fully replaced.

- [x] Phase 1 — shell: trim `NavRail` to 5 labelled items + avatar; `SidebarHost` (caps header + `+`,
      sync footer); promote the flight-deck centre (tabs + `SessionMirror` + diff) out of `DiffDrawer`
      into a permanent `CentrePane`; extract `ChangesRail`; remove dock/stacked/even-split + Broadcast
      → verify: boots to Sessions panel + `>_ Terminal` tab; tsc at the 28-error baseline
      ✓ 19/19 Playwright checks + 6 screenshots read (2026-07-29). New `DiffKit.tsx` (shared diff
      primitives) + `CentrePane.tsx` (permanent tabs + rail, commits switcher included early);
      `DiffDrawer` now PR-only; dock/stacked/maximise/broadcast/termFont/groups all removed from
      `Dashboard`; broadcast stripped through useTerminal/preload/main. Rail follows `focusedRepo`
      (placeholder when the shell is outside a repo); boot-order fix: centre adopts the shell when
      the first restored PTY lands. tsc: same 28 errors (line shifts only), node project clean.
- [x] Phase 1 fix — shell rendered off-screen: `xterm.css` was imported only by the now-unmounted
      `TerminalPanel`, so it left the bundle and xterm's panes stacked in normal flow (`.xterm` 2490px
      in a 762px host, cursor at y=977 of a 900px window). Moved the import to `useTerminal.ts`
      ✓ 22/22 driver checks, incl. two new permanent guards: `.xterm` height ≤ host height, and typing
      reaches the shell with no click first.
- [x] Phase 1 fix — restore banner reprinted on session switch: `CentrePane` rendered only the focused
      group, so a switch unmounted the xterm and the remount replayed the log. Now `Dashboard` passes
      every `sessionGroups` entry and `CentrePane` keeps each group it has shown mounted, hiding the
      inactive ones (`display: none`) ✓ 25/25 driver checks, incl. three new permanent guards: the
      stamped xterm node survives a switch round trip, ≤1 restore banner, exactly one visible group.
- [x] Phase 2 — `SessionsPanel`: AGENTS (status dot, age / `needs input`, branch/ticket subtitle) +
      SHELLS (⟳ branch + working-tree ±) from the existing agents/shells split; `Pull requests · N
      need you ›` row jumps to the PRs panel → verify: selecting a shell re-points the Terminal tab
      ✓ driver confirms the re-point, both row shapes, and the orange `needs input` transition — full
      write-up in the Phase 2 spec section at the top of this file
- [x] Phase 3 — `FilesPanel`: port `FileTreeModal` into the sidebar; repo header + branch chip;
      filter with `In files │ Filenames` segmented control (content search via grep IPC if missing)
      → verify: picking a file adds the `</> name` tab and switches to it
      ✓ only the branch chip was actually missing — hosting, the segmented control and `repo:grep-matches`
      all already shipped; driver confirms both header states, the `</>` tab and all four root shapes —
      full write-up in the Phase 3 spec section at the top of this file
- [x] Phase 4 — `PRsPanel`: replace the repo-grouped list with GitHub-Inbox-style sections (mockup
      approved 2026-07-30 against the user's screenshot): **Needs your review** / **Needs your teams'
      review** / **Your drafts** / **Waiting for review or checks** / **Needs action** / **Ready to
      merge**, each collapsible with a count badge; row = branch/draft icon + bold title + `repo#number
      · author · Updated Xh ago` subtitle. Panel becomes resizable (mirrors `FileTreeDrawer`'s `width`/
      `onWidthChange` pattern, default wider than Files' 260px — six-section rows need the room).
      Existing Claude Worktrees / Repos (pin mgmt) / Local branches sections stay put, unchanged, below
      the new grouping (Repos was later removed — see Review). No left sub-nav (Inbox/Authored by
      me/.../Views) — six sections only, per user decision.
  - [x] `electron/main/index.ts` `prs:list` — extend `gh pr list --json` with `reviewRequests,
        statusCheckRollup,mergeable,mergeStateStatus` (`updatedAt` already fetched, just untyped);
        update `PRNode` type → verify: raw IPC response carries the new fields for a pinned repo
  - [x] `electron/preload/index.ts` + `useTerminal.ts` — reconcile the two divergent `listPRs` type
        declarations, add the new fields → verify: tsc clean on both projects
  - [x] `PRsDrawer.tsx` — categorisation fn (needs `getGhLogin()` for "you"); approximation: any
        `Team`-typed `reviewRequests` entry counts as "needs your team's review" (no per-team
        membership check — would need extra `read:org` scope/calls) → verify: a PR with a direct
        review request lands under "Needs your review", not the team bucket
  - [x] `Dashboard.tsx` — `prsWidth` state + `tdash:prs-width` localStorage, passed to `PRsDrawer` as
        `width`/`onWidthChange` (mirrors `fileTreeWidth`) → verify: drag-resize persists across reload
  - [x] `npx tsc --noEmit -p tsconfig.web.json` / `tsconfig.node.json`; `npm run build && node
        drive.mjs` (update PR-panel checks for the new section headers) → verify: baseline held, driver
        passes
- [x] Phase 5 — ChangesRail v2 + diff polish: `Working tree +a −d · Commits` switcher row; two-line
      file rows (status square, path subtitle, ± + 5-box stat); sticky Stage all / Discard; centre
      breadcrumb `+a −d ^ v` hunk nav + blue hunk-header band → verify: counts match `git status`,
      chevrons walk hunks — **done, 20/20 driver assertions; see the Phase 5 section above.** Four of
      the five items were already shipped; only the hunk nav was new
- [x] Phase 6 — status bar `⟳ branch · N changed` / `N open PRs · N need you · ● synced Xm`; sidebar
      footer mirrors it → verify: strings match the mock — **done, 24/24 driver assertions; see the
      Phase 6 section below.** Both strips are one component, so "mirrors" is structural, not a
      convention someone has to remember
- [ ] Phase 7 — sweep: remove code orphaned by the move (old drawer shells, dock plumbing), tsc both
      projects, `npm run build && node drive.mjs` across all three mock states + read screenshots
      → verify: 3 screenshots structurally match the mocks

## Git changes UI redesign (DiffDrawer working-tree tab)

- [x] Add `StatBlocks` (5-box diffstat) + repo glyph helpers → verify: renders green/red/empty split, never >5 boxes
- [x] Rebuild the working-tree layout: diff pane left (flex), `CHANGES` rail right (fixed 240px) → verify: rail sits on the far right, diff fills the rest
- [x] Rail: `panelHeader` (CHANGES + branch chip + refresh), working-tree summary row, STAGED/UNSTAGED sections, sticky footer (primary Stage all + Discard) → verify: counts and stats match `git status`
- [x] Rail rows use `rowState` for selection (fill + inset left bar), not the old coloured left border → verify: matches design system
- [x] Diff pane: file header (name + staged badge + copy/open icons) and breadcrumb path row with `+n −n` → verify: breadcrumb shows repo + dir segments
- [x] Drop the now-duplicated Uncommitted pill / Discard all / counts pill from the drawer header on this tab
- [x] Tab-aware minimum drawer width so the rail can't crush the diff pane at a narrow persisted width
- [x] `npx tsc --noEmit -p tsconfig.web.json` — no new errors beyond the 28-error baseline

## Flight Deck v2 — one centre pane, one tab strip

- [x] Tab strip becomes the centre pane's header on the working-tree tab (drawer header hidden; maximise/refresh/close fold into the strip) → verify: no separate panel header above the diff
- [x] Session tab mirrors the repo's existing shell instead of spawning one; DOM renderer, `ownsPtySize` follows visibility → verify: `tput cols` tracks the pane, WebGL row offset gone
- [x] A split adds a **pane** to that one session tab, never a second tab → verify: strip reads `>_ <repo> 2`, two live PTYs, transcripts survive a row→column reflow
- [x] Both open (file + git): the viewer becomes the left-most tab (`</> name ×`) instead of a second wide column → verify: exactly one wide centre column, `CHANGES` still at x≈1460
- [x] Tab bodies hidden not unmounted, so the editor keeps scroll/undo and the mirrors stay attached → verify: markers still in both panes after a full tab round trip
- [x] Type-check: renderer error set identical to the HEAD baseline (28), `tsconfig.node.json` clean

## Diff colour — tone the wash down

- [x] Six purpose-named tokens (`diffAddBg`/`diffDelBg`, `diffAddBar`/`diffDelBar`, `diffAddFg`/`diffDelFg`) across all four themes → verify: no diff colour re-derived inline
- [x] Row tint drops to `#0f2119` / `#24151b`; 2px marker bar carries the hue → verify: tint is a hue cast (≈1.02:1 vs `surface1`), not a lightness step
- [x] Changed-line text lifts to `label1`, context stays `label3` → verify: code reads as code, changed lines still lead
- [x] Change bars, status letters and `+/−` counts use the muted pair (incl. `RepoSidebar` tab stats) → verify: no two greens for `+counts` side by side
- [x] Measured contrast, not eyeballed → verify: worst text 3.76:1 ≥ 3.5 floor; `diffDelBar` shortfall recorded below

## Session tab follows the focused session

- [x] Seed the drawer's mirror from the focused panel, falling back to a cwd match on the drawer's repo → verify: tab re-labels `>_ terminal-dashboard` → `>_ mobile-edge-service` on a sidebar switch
- [x] A repo change no longer kicks you off the session tab or detaches the mirror → verify: `active=true` and one 1129×855 xterm after the switch
- [x] Shell strip shows the mirrored session's own branch, not the drawer repo's → verify: strip reads `zsh main` while `CHANGES` still says `main` for its own repo
- [x] Dock stays suppressed — one terminal on screen, always the focused one → verify: exactly one non-zero-size xterm throughout
- [x] Type-check: renderer error set identical to the 28-error baseline, `tsconfig.node.json` clean

## Shell is home — git adds tabs beside it

- [x] Session tab moves to first in the strip → verify: strip reads `>_ repo | CLAUDE.md +20`, session at index 0
- [x] Opening git lands on the session tab, no click needed → verify: `active=true` on the session tab straight after the rail button
- [x] No file tab until a file is actually opened → verify: strip holds one tab when git opens on a dirty repo
- [x] Picking a file in `CHANGES` adds its tab and switches to it; one click returns to the shell → verify: transcript intact across the round trip
- [x] Every fallback returns to the shell rather than an empty diff pane (`homeTab`) → verify: closing the viewer tab lands on the terminal, not "Select a file"
- [x] Type-check: renderer error set identical to the 28-error baseline, `tsconfig.node.json` clean

## Review

- **Remove the Repositories section from the Sessions sidebar**: `RepoSidebar.tsx`'s Repositories block
  (PR tracking/browsing, clone-by-URL, "NOT TRACKING" list, footer PR-count summary) was legacy — a
  standalone `PRsDrawer` already re-implements PR listing/filtering independently, and the two had
  already drifted onto different localStorage keys (`td_pinned_repos` vs `tdash:pinned-repos`). Cut
  ~870 lines while preserving `prs`/`repoTabStats`/`tabPRCache`, which the Sessions row renderer reads
  directly for tab badges and does not depend on the deleted UI. Three capabilities were re-homed rather
  than dropped: the in-app PR diff trigger moved to a new "± Diff" button on `PRsDrawer`'s PR cards; the
  branch-checkout picker moved to a clickable branch chip in `CentrePane`'s shell strip (new
  `BranchPicker`: search + arrow-key nav + checkout); the clone-by-URL modal was dropped per the user's
  decision (no other UI can clone a repo now). `selectedRepoTree`/`sinceLabel` in `Dashboard.tsx` became
  dead code as a direct consequence and were removed alongside. Note: `isBranchTab` in `RepoSidebar.tsx`
  was already dead code (zero call sites) before this change and was left untouched, per Surgical
  Changes. Verified live via Playwright `_electron`: sidebar is Sessions-only and fills the full column
  height, the branch dropdown opens under the shell-strip chip with working search/arrow-nav/Escape, and
  tsc improved to 21 errors from the 28-error baseline (node project clean).

- **Shell is home — git adds tabs beside it**: opening git used to land on the diff pane, so the shell
  you were working in disappeared until you found and clicked its tab. Now the session tab is first in
  the strip and is where the pane opens, and file tabs are *added* beside it — the strip holds exactly
  one tab when git opens, because nothing auto-selects a changed file. One new derived value,
  `homeTab` (`"terminal"` when the mirror has panes, else `"file"`), replaced the three hard-coded
  `"file"` fallbacks, so closing a viewer tab or switching repos drops back to the shell instead of an
  empty "Select a file" pane. Clicking a `CHANGES` row still switches to that file's diff — a
  deliberate action, unchanged. Verified live via Playwright `_electron`, 10/10 assertions +
  screenshots read: git opens on `>_ terminal-dashboard` with the live transcript and the 10-file
  `CHANGES` rail, picking `CLAUDE.md` yields `>_ terminal-dashboard | CLAUDE.md +20` with the diff
  showing, and one click back restores the shell.

- **Session tab follows the focused session**: with git on, switching sessions in the sidebar left the
  drawer showing the *old* shell. Two causes. The mirror was seeded by cwd-matching the drawer's repo,
  so it could never point outside it; and `Dashboard`'s pre-existing `focusedRepo` effect re-points the
  whole drawer on a switch, which changed `DiffDrawer`'s `repoName` and tripped its `[repoName]` effect
  into `setPaneTab("file")` + `setTermOpened(false)` — kicking you off the session tab and detaching a
  live mirror. The seed now prefers the focused panel (whole split group travels with it), and the repo
  effect only resets *file* tabs: `setPaneTab((cur) => (cur === "terminal" ? cur : "file"))`, with
  `termOpened` left alone. The strip's branch chip now comes from the mirrored session rather than the
  drawer's repo, since the two can legitimately differ. Verified live via Playwright `_electron`, 10/10
  assertions + screenshots read: tab re-labelled and still active, mirror re-pointed to
  `~/mobile-edge-service main ›`, one terminal on screen, and the round trip back restored
  `>_ terminal-dashboard` / `zsh cowork` with the original transcript intact.

- **Diff colour — tone the wash down**: diff colour now rides the gutter, sign and stat instead of a
  full-bleed wash. `src/theme.ts` gained six tokens so nothing re-derives green/red inline; 38 call
  sites across `DiffDrawer` + `RepoSidebar` moved onto them. Rows tint to `#0f2119`/`#24151b` — a
  near-isoluminant hue cast (1.015:1 / 1.029:1 against `surface1`), so it reads as tone rather than
  brightness — with a 2px marker bar and the `+`/`−` sign carrying the actual hue, and changed-line
  text lifted to `label1` while context stays `label3`. Two measured departures from the brief:
  `#a5544f` as *text* is 2.77–3.32:1, under the stated 3.5:1 floor, so text uses `#bd6a62`
  (3.76–4.51:1, near-isoluminant with `#4f8f66` at L 0.2201 vs 0.2227 so the pair stays balanced);
  and `#a5544f` as a *bar* is 2.87:1 on a hovered rail row and 2.77:1 on a selected one, under the
  WCAG 1.4.11 3:1 non-text floor — kept as specified since the brief's floor was textual, but
  `diffDelBar: "#bd6a62"` is the one-token fix if that matters. Verified: renderer type-check error
  set identical to the 28-error baseline, `tsconfig.node.json` clean, 16/16 Playwright assertions,
  and the diff pane read at 3× to confirm the tint doesn't swamp the code.

- **Flight Deck v2 — one centre pane, one tab strip**: `DiffDrawer` owns the strip and hosts three
  kinds of tab — the open file (passed in as `viewerTab`, so `FileViewer` keeps its editor/find/save
  logic and only gains an `embedded` flag), the selected diff file, and the repo's shell group. The
  shell is *mirrored*, never spawned, and a split adds a pane to the same tab rather than a second
  one. `Dashboard` now takes a single `onLayout({flightDeck, hostsSession})` report and uses it to
  decide who owns the dock: `centreHostsViewer` suppresses the sibling viewer column, the stacked
  layout, and the even-split width effect. The layout report resets on unmount only — clearing it on
  every dep change flashed `false` through Dashboard and remounted the editor. Verified live via
  Playwright `_electron` (16 geometry/text assertions + screenshots read): strip order
  `</> CLAUDE.md × | Dashboard.tsx +41 −7 | >_ terminal-dashboard 2`, one 1120px centre column,
  panes refit 76→58 cols when the tree opened, transcripts intact across a round trip.

- **PRs panel — GitHub Inbox parity**: `PRsDrawer`'s repo-grouped list is now six collapsible,
  count-badged sections (mockup approved 2026-07-30 against the user's screenshot of GitHub's Pull
  Requests Inbox): Needs your review / Needs your teams' review / Your drafts / Waiting for review or
  checks / Needs action / Ready to merge. `categorizePR` sorts each PR using `isDraft`,
  `reviewDecision`, `statusCheckRollup` and `mergeable` for the user's own PRs, and `reviewRequests`
  (`User`- vs `Team`-typed entries) for PRs authored by others — all fetched in the existing bulk
  `gh pr list --json` call, no N+1 calls added. Documented approximation: "needs your teams' review"
  matches any team-typed review request, not specifically a team the user belongs to — true membership
  narrowing needs an org lookup and a `read:org` scope this tool doesn't request. Card headers switched
  to icon + bold title + `repo#number · author · Updated Xh ago`, dropping the now-redundant draft pill
  and createdAt chip. The panel is resizable (mirrors `FileTreeDrawer`'s controlled-width/drag-handle
  pattern), default 480px, floor 320px, width persisted to `tdash:prs-width`. Getting the fields to the
  renderer required fixing a real type-drift bug: `useTerminal.ts`'s `declare global` block — the actual
  type `PRsDrawer.tsx` compiles against, not `preload/index.ts`'s own return-type annotation — had a
  stale `listPRs` signature missing `pinnedRepoNames` and `author`. Verified: tsc clean on
  `tsconfig.node.json`, renderer errors unchanged at 15 (down from the 28 baseline, all pre-existing and
  unrelated to these files) with zero new errors in the four touched files; `npm run build && node
  drive.mjs`, 35/35 assertions passed live including all six section labels present, a drag-resize
  widening 480→540px, the width surviving a panel toggle, and — assumed at the time to be
  environment-dependent (no `gh` auth) — a skip on the "± Diff" → `DiffDrawer` trigger. That
  assumption was wrong; see the follow-up entry below for the real cause.

- **Fix: PRs panel showed 0 PRs against the user's real repos; removed the Repos (pin mgmt) section**:
  user reported the six-section panel read all zeros while GitHub's real Inbox showed active PRs, and
  asked to remove the "Repos" section (pin-star toggles + branch chips) below the six sections. Root
  cause: `electron/main/index.ts`'s `prs:list` handler short-circuits to `[]` whenever it's called with
  an empty repo-name array, and `PRsDrawer.tsx` was calling `listPRs([...pinnedRepos])` — with zero
  repos pinned, every section legitimately computed to zero; unrelated to `gh` auth (the assumption in
  the entry above). Fixed by changing `load()` to chain `listGithubRepos()` into
  `listPRs(repoList.map(r => r.name))`, so PR fetching covers every local repo instead of a manually
  pinned subset — which also made the pin-management UI pointless, so it's now deleted along with
  `pinnedRepos`/`togglePin`/`sortedRepos`/`showRepos` state and the dead pin-driven reload effect.
  Real trade-off worth flagging: fetching real data for 39 repos means the panel now genuinely takes
  ~9s to settle on open (concurrent `gh pr list` calls through the pre-existing 20s-per-repo timeout),
  versus the old pin-gated path's instant-but-wrong empty result — and since `PRsDrawer` remounts on
  every panel toggle, that ~9s reload cost repeats each time. Verified: tsc clean on both projects (22
  web errors, none new/in touched files); `npm run build && node drive.mjs`, 34/34 assertions passed
  live against the user's real 39 repos — "Needs your review" surfaced the exact MOB-396 PR from their
  GitHub screenshot, "Needs your teams' review" showed 58 real PRs, and the "± Diff" → `DiffDrawer`
  trigger (previously skipped) now fires correctly once checked before the resize test's remount.
  Follow-up: real PR data also revealed a pre-existing author-filter row (one pill per distinct PR
  author, click to filter) that used to render empty under the pin-gate bug — with real data across an
  org's worth of repos it became a 50+ chip wall pushing the six sections below the fold. Removed
  entirely per user decision (`ownerFilter`/`filteredPRs`/`uniqueOwners` state and the pill-row JSX);
  the two empty-states it fed collapsed into the single unconditional "No open PRs" one. Re-verified:
  tsc clean (22 web errors, unchanged, none in this file), 34/34 driver assertions, screenshot confirms
  the header stats now sit directly above "Needs your review" with no pill row between them.
  Second follow-up: removed the "Local branches" section too (branches with no open PR, multi-select +
  bulk delete, per-repo "clean merged" action) — `LocalBranchCard`, its six pieces of state
  (`localBranches`/`localLoading`/`showLocal`/`selected`/`deleting`/`cleanMsg`),
  `reloadLocal`/`toggleSelect`/`handleDeleteSelected`/`handleCleanMerged`, and the derived
  `prBranchKeys`/`localOnly`/`localByRepo`. `window.terminal.listLocalBranches` stays wired — it also
  feeds `Dashboard.tsx`'s unrelated shell-strip branch-checkout picker, so the IPC surface (main +
  preload) is untouched; only this drawer's own copy of the data and UI is gone. Header summary
  dropped its trailing "· N branches" clause. Re-verified: tsc clean (15 web errors, zero in this
  file), `tsconfig.node.json` clean, `npm run build` succeeded, 34/34 driver assertions, screenshot
  confirms nothing renders below the six PR sections.
  Third follow-up — GitHub filter parity ("apply same filter and config with github pull request", two
  screenshots: GitHub's `Updated: Last 3 months ▾` dropdown, and its `contributed-by:@me` repo picker
  with every box unchecked). Two real divergences from GitHub, both fixed:
  1. **No Updated window** — we fetched every open PR ever, GitHub defaults to the last 3 months. Added
     an `Updated:` chip in a new filter row under the drawer header, with GitHub's exact four options
     (Last month / Last 3 months / Last year / Any time), `✓` on the active one, persisted to
     `localStorage["tdash:prs-updated-window"]`, default `3mo`. Filtered **client-side** on the
     already-fetched `updatedAt` rather than via `gh search`: an early `--search`-driven design was
     abandoned after it tripped the search API's secondary rate limit (HTTP 403) during development —
     that limit is far tighter than the repo endpoints and would fire on the 5-minute auto-refresh.
     Client-side also makes the toggle instant instead of a ~9s refetch. Cost: zero extra API quota.
  2. **"Needs your teams' review" matched *any* team** — 35 PRs at 3mo, because the token turned out to
     have `read:org` all along. New `gh api user/teams` handler (`gh:my-teams`) narrows it to the user's
     five real teams. Measured over all 344 open PRs: 30→3 (1mo), 35→4 (3mo), 53→9 (1y), 58→13 (any);
     every other section byte-identical. Watch out — `gh pr list` puts the **org-qualified** team in
     `slug` (`Skedulo/v3-backend-core`) and the bare one in `name`, the opposite of what the shape looks
     like; `teamMatchSet()` holds both forms, and an empty team list falls back to the old any-team
     behaviour rather than silently emptying the section.
  Also fixed while in here: `gh pr list` was running at its default `--limit 30`, silently truncating
  any repo with more open PRs → now `--limit 100`. And the header read the raw open-PR total (236) while
  only 6 rows rendered; PRs are now bucketed once and the header reports that `inboxCount`.
  `contributed-by:@me` from the second screenshot is deliberately *not* implemented — every checkbox in
  that modal is unchecked, so the qualifier scopes the picker's candidate list, not the results.
  Verified: tsc clean on both projects (15 web errors, pre-existing baseline, none in touched files);
  `npm run build`; 51/51 driver assertions (14 new ones covering the chip label, all four options, the
  `✓`, Escape closing the menu before the drawer, click-outside dismissal, and header == sum-of-sections)
  against the user's real 39 repos. Result matches their GitHub inbox exactly: 1 needs-your-review +
  4 needs-teams-review + 1 draft = 6, against 312 open / 57 team-review before.

- **Git changes UI redesign (working-tree tab)**: rebuilt `DiffDrawer`'s working-tree tab as a
  two-pane layout — unified diff on the left (file header with staged chip + copy/open icons, then
  a repo/path breadcrumb row carrying `+n −n`), fixed 240px `CHANGES` rail on the right (branch chip
  + refresh, working-tree summary, `STAGED`/`UNSTAGED` sections, sticky primary Stage all + Discard
  footer). Rail rows now use the design-system `rowState` selection (fill + inset accent) instead of
  a coloured left border, and carry a GitHub-style 5-box diffstat (`StatBlocks`). Branch diff and
  Commits tabs are untouched. The drawer's persisted width (~435px) left the diff pane at ~190px, so
  `minWidth` is now tab-aware (`RAIL_W + 400` on this tab) and clamps the rendered width, not just
  the drag. `stageAll`/`unstageAll` also re-point the open diff at the surviving copy of the file.
  Verified live via Playwright `_electron` against a real repo with uncommitted changes; type-check
  holds at the 28-error baseline.

- **Clear completed todos**: per-file "Clear done" button on each todo.md card in the Tasks drawer, behind a confirm modal. New IPC `claude:clear-completed-todo-file-items` strips all `- [x]` lines in one rewrite. Touched: electron/main/index.ts, electron/preload/index.ts, src/hooks/useTerminal.ts, src/components/TasksDrawer.tsx.
- **Taller change-directory bar**: bumped the terminal panel's bottom status bar padding 2px → 7px (src/components/TerminalPanel.tsx). Verified live via `npm run dev`.
- **Fix: mobile-edge todos vanished after clearing another repo**: root cause was `findTodoFiles` skipping *all* dot-dirs, so `.claude/local/tasks/todo.md` (mobile-edge's real todo file) was undiscoverable by scan/rescan — once its in-memory session was lost on a boot/HMR restart, no rescan could restore it. Fixed by descending into `.claude` while still skipping other dot-dirs (electron/main/index.ts `findTodoFiles`). Verified: after restart the scan re-registers the 73-task file.

## Session/terminal label ignores the live cwd + diff selection lost on session switch (2026-07-31)

Reported: the session row and the centre tab both read `terminal-dashboard` while the shell sits in
`mobile-edge-service`; and the open diff file is forgotten when switching sessions.

- [x] **Bug 1 — the title is pinned at creation.** `addPanel` sets `pinned: !isPlaceholderTitle(title)`,
  so every session created from a repo / branch / directory pins a title that is *itself* just a cwd
  snapshot. `cwdTitle` then never runs (`p.pinned ? p.title : cwdTitle(cwd)`), and both readouts prefer
  the stored title — `activeGroup.title` in CentrePane, `displayName` in RepoSidebar.
  - [x] Pin only what the cwd cannot express: an explicit rename, and `claude <id>`. Rename the flag
        `pinned` → `named` so persisted state written under the old semantics is ignored by construction
        (otherwise existing sessions stay stuck until recreated — a fix that can't reach live state).
  - [x] Teach `cwdTitle` worktree paths (`<repo>-worktrees/<dir>` → `<repo>:<dir>`), else unpinning the
        `repo:branch` sessions degrades them to `<repo>-worktrees`.
- [x] **Bug 2 — the diff selection is dropped, not parked.** The repo-switch effect in CentrePane does
  `setSelectedFile(null)`; `repoName` is derived from the focused panel's cwd, so every session switch
  wipes it. Park it per repo in the existing `rootMemory` store (already does this for the file tree).
  - [x] Restore on the way back in, and keep the file tab if the incoming repo has one remembered.
  - [x] Add `repoName` to the `getFileDiff` effect deps — with restore in play, two repos sharing a
        path (`README.md`) would otherwise render the previous repo's diff.
  - [x] Drop a remembered selection whose file no longer has changes.
- [x] Verify: type-check both projects; drive the real app for the label and the round-trip.

### Review

**Bug 1 — stale session/terminal label.** Root cause was an asymmetry in `sessionGroups`: it exposed
`title` (frozen at creation) beside `repo` (recomputed from the live cwd). `addPanel` inferred
`pinned` from the title, and *every* creation title except `claude <id>` is cwd-derived, so the
inference pinned exactly the titles that go stale. Fix: `named` is now opt-in — `handleRename` and
`handleResumeClaude` set it, nothing else does, and unnamed panels retitle from `cwdTitle(cwd)` on
every prompt. `cwdTitle` learned worktree paths first, so unpinning a `repo:branch` session keeps its
shape instead of collapsing to `<repo>-worktrees`. The `pinned` → `named` rename is the migration:
`~/.terminal-dashboard/state.json` held `pinned: true` on all three of the reported panels, and
reading a differently-named key means that persisted flag is ignored rather than needing a clear.
Touched `Dashboard.tsx` plus the `named` field in `electron/main/index.ts`, `preload/index.ts` and
`useTerminal.ts` (both the `savePanels` write type *and* the `getState().lastPanels` read type).

**Bug 2 — diff selection lost on session switch.** Parked per repo in the existing `rootMemory`
store. Deliberately a synchronous `selectFile` wrapper rather than a save-`useEffect`: on a repo
change the reset effect runs first, so a save effect declared after it would write the *old*
selection under the *new* repo key. The PR-takeover `setSelectedFile(null)` stays raw on purpose —
reviewing a PR should park the working-tree selection, not forget it.

Verified: `tsc` clean on `tsconfig.node.json`; `tsconfig.web.json` holds at the 15-error pre-existing
baseline with nothing in `CentrePane.tsx`/`rootMemory.ts` and nothing referencing the new code. 19
assertions in `scratchpad/verify.mjs` over the *real* source — `cwdTitle` sliced out of Dashboard.tsx
and evaluated (plain repo, subdir, worktree, worktree subdir, bare `-worktrees` root, `~`, non-GitHub
path, trailing slash, `/`), and `rootMemory` type-stripped with a `localStorage` stub (park/restore
per repo, cross-repo isolation, `diff` and `expanded` patches not clobbering each other, and a legacy
root written before the slot existed reading `null` rather than crashing).

Flagged, not fixed (pre-existing, out of scope): `loadRoot` returns a shared `EMPTY` singleton, so an
in-place mutation of an unknown root's `.expanded` would poison every later unknown root. Latent —
all three callers copy (`new Set(...)`, `.map`) and the new code only reads `.diff`.

## Backspace does nothing in a restored terminal (recurrence) — done

- [x] Confirm the earlier `lastCols = 0` fix is in the running build (it is — so this is a second hole, not a regression)
- [x] Root-cause: restored panels are never measured, so the pty keeps the `create(220, 50, …)` spawn guess
- [x] Fix in main: persist the newest measured pane geometry and lend it to every never-measured session
- [x] Verify on a throwaway instance (temp `HOME`) that no pty is left at 220×50
- [x] `tsc` node clean / web at baseline

**Root cause.** `SessionMirror` is now the only view of a pty, and `CentrePane` mounts a group only
once it has been the active terminal tab (`openedGroups`). A restored panel therefore has no
measurement at all — its pty sits at the `create(220, 50, …)` placeholder until the user first
activates that group. Anything that reaches that shell before then (typing right after a switch, an
injected `cd` via `POST /cd`) is line-edited by zsh against 220 columns on a ~114-column grid, so
`ESC[A`/`ESC[K` clear a row the user isn't looking at and the character stays painted. Measured on
the user's live app: `ttys005` at exactly `220×50` with their own keystrokes in `terminal-338.log`,
while its siblings read 137.

**Fix** (`electron/main/index.ts`, main only). `state.paneSize` records the newest geometry the
renderer has actually measured and is persisted; `createSession` spawns with it in preference to the
caller's placeholder; `unmeasuredSessions` tracks sessions the renderer has never sized, and
`terminal:resize` lends each new measurement to all of them. Un-viewed panels are now correct by
construction, and the six `create(220, 50, …)` call sites are left untouched — their argument is
simply no longer load-bearing.

**Verified** on a throwaway instance (temp `HOME`, the user's real `state.json`, `paneSize` stripped
to force the cold path):

| | before | after |
|---|---|---|
| cold boot, 4 restored panels | `220x50 220x50 220x50 114x50` | `114x50 ×4` |
| after 3 group switches | `114x50 ×4` (one repaired per switch) | n/a — already correct at boot |
| new panel via `POST /new-terminal` | `114x50` | `114x50` |
| warm boot (paneSize persisted) | — | `114x50` from spawn; polled every 250 ms, never 220 |

Independent check from zsh's own belief — the `PROMPT_SP` padding readout over every log of the run:
`last=114 history=114×3` on all five panels, i.e. not one prompt was ever computed against 220.
`tsc -p tsconfig.node.json` clean; `-p tsconfig.web.json` holds at the 15-error pre-existing baseline
(no renderer file touched).

Note: live panels already running keep their wrong size — this can only fix sessions created after
the build lands, so the app needs a restart.

---

## Changes rail: wrong branch and missing files in a worktree

**Report:** "working tree does not reflect with active branch, does not show all changed files".

**Root cause.** The rail identified a repo by a *path segment*, not by its checkout root:

```ts
const focusedRepo = focusedPanel?.cwd?.match(/\/Documents\/GitHub\/([^/]+)/)?.[1] ?? null;
```

For a linked worktree — `~/Documents/GitHub/mobile-edge-service-worktrees/tungtran/ENG-64481/…`,
which the app creates itself — that captures `mobile-edge-service-worktrees`, a plain directory with
no `.git`. Every git call in the rail then ran outside a repo. Measured against the user's real
worktree:

| | old value (`mobile-edge-service-worktrees`) | new value (git-resolved root) |
|---|---|---|
| `getRepoBranch` | `null` | `tungtran/ENG-64481/fix-high-memory-prod` |
| `getRepoStatus` | `null` | `{branch, ahead 0, behind 0, changed 0}` |
| `getWorkingTree` | `0` files | correct list |

`git:working-tree` swallows the failure (`catch { return {staged: [], unstaged: []} }`), so this
surfaced as a silently empty rail rather than an error. `cwdTitle` already understood worktrees, so
the *tab* read `mobile-edge-service:…` while the rail beside it was blank.

Two smaller faults of the same family, both fixed here:
- `git:working-tree`, `git:change-count`, the watcher and every stage/commit handler used
  `join(githubDir, repoName)` while `git:current-branch`/`git:repo-status` used `resolveRoot`, so no
  path-shaped argument could work even once the renderer sent one.
- A linked worktree's `HEAD`/`index` live in `<main>/.git/worktrees/<name>`, outside the watched
  directory — a checkout or stage there never refreshed the rail.

**Fix**
- [x] `git:repo-root` (main) — `git rev-parse --show-toplevel`; git decides where the checkout starts
- [x] Rail handlers switched from `join(githubDir, …)` to `resolveRoot` (a strict superset: bare
      names still resolve under `~/Documents/GitHub`, absolute paths now work too) — 12 sites
- [x] Watcher takes a second watch on the linked gitdir when `.git` is a file
- [x] `focusedRepoRoot` in `Dashboard` resolves the focused panel's cwd through git; `repoLabel()`
      derives the display name, so a worktree reads as its owning repo not `<repo>-worktrees`
- [x] `CentrePane` takes `repoRoot` alongside `repoName` — git commands and the diff/selection keys
      use the root, labels and PR lookup keep the name

**Verified** on a throwaway instance against a linked worktree with known contents
(`M README.md`, `A alpha.txt`, `M src/theme.ts`, `?? beta.txt`), deliberately placed *outside*
`~/Documents/GitHub` so it exercised the path case too:

| step | rail |
|---|---|
| initial | STAGED 1 `alpha.txt` · UNSTAGED 3 `README.md` `src/theme.ts` `beta.txt` — matches `git status --porcelain` |
| `git add beta.txt` (index is in the main repo's `.git/worktrees/`) | beta moves to STAGED unprompted — second watcher works |
| new `gamma.txt` | appears in UNSTAGED — original watcher intact |

Regression check on a normal checkout: branch `cowork`, 17 rows (16 real + a `.claude/` entry that is
a driver artefact — the throwaway `HOME` can't see `~/.config/git/ignore`).

`tsc -p tsconfig.node.json` clean. `-p tsconfig.web.json` compared against a `git worktree` of
unmodified `HEAD`: identical error set, no new errors.

Not covered: the PR-side handlers (`prs:*`, `github:*`) still key off `join(githubDir, repo)` — out
of scope here, but a PR reviewed against a worktree checkout would hit the same class of bug.

---

## Changes rail: branch diff view ("does not show all files changed in the PR")

**Report** — on a feature branch whose work is all committed, the rail shows `STAGED 0 / UNSTAGED 0`
even though the PR has files in it.

**Root cause** — not a bug in the working-tree view; that is correctly empty. The rail simply has no
view for *what the branch changed*. `railView` is `working-tree | commits | pr-files`, and `pr-files`
is reachable only when `prReview` is set, i.e. after opening a PR from the PRs drawer. Sitting in the
branch's own terminal there is no path to its diff.

**Agreed design** (mockup approved 2026-08-12) — segmented switcher, local branch diff.

```
┌──────────────────────────────────┐
│ CHANGES      tungtran/MO…     ⟳  │  panelHeader 34px
├──────────────────────────────────┤
│  Working tree │ Branch │ Commits │  switcher 30px, 2px bottom accent (paneTabStyle idiom)
├──────────────────────────────────┤
│ 14 files      +382 −77    vs main│  summary 30px
├──────────────────────────────────┤
│▎src/main/kotlin/Sync.kt   +40 −2 │  DiffFileRow, same as pr-files
│ src/test/SyncSpec.kt      +18 −0 │
└──────────────────────────────────┘
```

- Segment reads `PR #1234` when `gh` finds one for the branch, `Branch` otherwise — decorative only,
  resolved in the background so it never gates the diff.
- Source is `git diff <base>...HEAD`, base from `origin/HEAD` with fallbacks. Instant, offline,
  worktree-safe, works before a PR exists. Trade-off accepted: drifts if the remote head has commits
  that have not been pulled.
- Switcher replaces the `Commits →` / `← Working tree` link chain for the non-PR rail. PR review mode
  keeps its existing two-view chain.

**Fix**
- [x] `git:branch-diff` (main) — base resolution + `git diff <base>...HEAD`
- [x] `git:branch-pr` (main) — decorative PR number for the segment label
- [x] preload + `Window.terminal` decls
- [x] `CentrePane`: `railView` gains `branch`; switcher; branch summary row; file list
- [x] centre pane renders a selected branch file (share the pr-files diff body)
- [x] refresh off the existing worktree watcher — `movesGitStatus` already covers `refs/`

**Review**

Also fixed en route: `parseDiff` inferred file status from line counts, so an append-only edit read
as `A`. It now reads `new file mode` / `deleted file mode` off the `diff --git` header. This was
already wrong in the pr-files view, which shares the parser.

Verified by driving the built app with Playwright `_electron` against two repos and comparing to
`git diff <base>...HEAD --numstat`:

| Repo | Ground truth | Rail |
|---|---|---|
| Fixture (no remote → `main` fallback) | `1 0 README.md`, `2 0 alpha.txt`, `1 0 deep/nest/thing.md` | `3 files +4  vs main`, rows `M README.md +1`, `A alpha.txt +2`, `A thing.md +1` |
| `mobile-edge-service-worktrees/…/ENG-64481` (linked worktree, `origin/HEAD`) | `4 1 Dockerfile`, `1 1 …/application.yml` | `2 files +5 −2  vs main`, segment `PR #1373` |

Clicking a row opens its diff in the centre pane; Working tree → Branch → Commits → Working tree all
round-trip. Type checks: `tsconfig.node.json` clean, `tsconfig.web.json` identical to the recorded
baseline.

Not covered: the base drifts if `origin/main` is stale locally (accepted trade-off above), and the
segment falls back to `Branch` whenever `gh` is unauthenticated — which is how the label behaved in
the first driver run, before a token was in the environment.

**Flagged, not changed** — the pre-existing `git:commits` handler interpolates a branch name into a
shell string (`gh pr list --head "${headRefName}"`). Ref names admit `` ` ``, `;`, `&`, `|`, so that
is a local shell-injection surface. The two new handlers use `execFile` with an argv array and are
not affected.
