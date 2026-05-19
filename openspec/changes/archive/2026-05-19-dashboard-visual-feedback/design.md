## Context

`pi-dev-worktrees` currently emits `pi.events` for all state changes (workspace created/switched,
devcontainer starting/ready/stopped) — these are forwarded to the dashboard as `event_forward`
messages. However, the dashboard's session card UI has no visual representation of workspace
state. The extension status bar update (`ctx.ui.setStatus`) only shows inside the pi TUI.

The pi-agent-dashboard extension UI system provides two mechanisms we can use:
1. **`footer-segment` decorator** (Phase 2): pushed via `ui:list-modules` probe; rendered in
   `SessionHeader.tsx` right of the git/model info. Refreshes on `ui:invalidate`.
2. **`management-modal` module** (Phase 1): a full table/action modal triggered by a slash
   command. Declared once; data fetched lazily via a `ui_management` round-trip.

The bridge discovers both by emitting `ui:list-modules` on `session_start` and every
`ui:invalidate`. The extension registers a synchronous listener; no async, no new protocol.

**Current codebase state:** `dashboard-events.ts` has `emitStateUpdate(pi, state)` which
calls `pi.events.emit("pi-dev-worktrees:state", state)`. All command/tool handlers call this
after any mutation. The state object (`WorktreesState`) lives in `session.ts`.

## Goals / Non-Goals

**Goals:**
- Show active worktree branch and devcontainer state on every session card in the dashboard
- Provide a `/workspaces` management modal with a table of all worktrees + per-row Remove action
- Keep state in sync: every mutation triggers `ui:invalidate` so card and modal refresh
- Zero new runtime npm dependencies (types only, devDependency)
- No changes to existing routing, bash intercept, or session state logic

**Non-Goals:**
- Showing worktrees across *all* sessions in one table (each session has its own state)
- A "create worktree" UI in the modal (slash command already handles this)
- Devcontainer start/stop from the modal (slash command already handles this)
- Full RJSF form rendering (Phase 4 of extension-ui-system — not yet shipped)

## Decisions

### D1 — Single `dashboard-ui.ts` module with `registerDashboardUi(pi)` entry point

All `ui:list-modules` listener logic, data event handlers, and invalidation helpers go in a
new `dashboard-ui.ts`. `index.ts` calls `registerDashboardUi(pi)` once in the extension entry
point alongside command registration. `dashboard-events.ts` gets a thin `invalidateDashboardUi(pi)`
call inside `emitStateUpdate`.

**Alternative**: inline everything in `index.ts`. Rejected — `index.ts` is already 300 lines;
separating UI concerns keeps it reviewable and testable independently.

### D2 — `footer-segment` namespace `"pi-dev-worktrees"`, id `"workspace-state"`

Namespace must match `/^[a-z0-9-]+$/`; `"pi-dev-worktrees"` satisfies this. Using a stable id
means every probe produces a single cache entry at key `footer-segment:pi-dev-worktrees:workspace-state`.
When both worktree and devcontainer are off, push `removed: true` to clear the decorator
from the card rather than showing empty text.

**Format strings:**
- Worktree only: `⎇ <branch>`
- Devcontainer only: `🐳 on` (or `🐳 starting…`)
- Both: `⎇ <branch>  🐳 on`
- Neither: decorator removed

### D3 — `management-modal` command `"/workspaces"`, id `"worktrees-table"`, data event `"workspaces:list"`

The modal declares a `table` view with columns: `branch` (text), `path` (text), `age` (text),
`dirty` (boolean). `dataEvent: "workspaces:list"` — the bridge emits this on `pi.events`;
the listener populates `data.items` synchronously from a fresh `wtp list --quiet` + `git status`
snapshot. `rowKey: "branch"`.

Per-row action: `{ id: "remove", label: "Remove", variant: "danger", event: "workspaces:delete-row",
confirm: "Remove this worktree? Any uncommitted changes will be lost." }`.

On `workspaces:delete-row` the listener reads `data.branch`, calls `wtp remove <branch>` (or
`wtp remove --force <branch>` if dirty), updates `state.worktree` if active, saves, and emits
`ui:invalidate` to refresh the modal and footer segment in one probe.

### D4 — Types imported from `@blackbelt-technology/pi-dashboard-shared` as devDependency only

The shared package exports `ExtensionUiModule`, `DecoratorDescriptor`, `FooterSegmentPayload`
etc. at `@blackbelt-technology/pi-dashboard-shared/types.js`. Adding it as a devDependency
gives us type safety at author-time without bundling anything extra at runtime — the extension
is loaded by jiti, which strips types, and the actual listener just pushes plain objects into
`probe.modules`.

**Alternative**: copy the relevant type interfaces inline. Rejected — types will drift as the
dashboard evolves; referencing the canonical source is strictly better.

### D5 — Synchronous data population for `workspaces:list`

`execSync("wtp list --quiet", ...)` and per-entry `git status --porcelain` are fast enough
(< 50 ms for a handful of worktrees) to satisfy the synchronous `data.items` fast path in
`handleUiManagement`. No async reply needed. The `_reply` callback path is available as
fallback if we ever need async probing, but we won't use it in v1.

## Risks / Trade-offs

- **`wtp list --quiet` format stability**: the command may change output format in future wtp
  versions. Mitigation: fall back to `enumerateWorktreeDirs` (already exists for this purpose)
  when `wtp list` fails or produces unexpected output.
- **Synchronous `execSync` in probe handler**: all `ui:list-modules` listeners are called
  synchronously; a slow `wtp list` could delay the probe result. Mitigation: 3-second timeout
  on all `execSync` calls, same as the existing bash-intercept helper.
- **`footer-segment` rendering position**: the dashboard renders `footer-segment` decorators
  right of the git/model info in `SessionHeader.tsx`. If the branch name is long it may
  truncate. Mitigation: cap branch display to 20 chars with `…` suffix; no action needed
  in the extension — this is a display concern.
- **No dashboard = no-op**: when the pi session runs without a dashboard bridge, `ui:list-modules`
  is never emitted and the `ui:invalidate` calls are dropped silently. The TUI status bar
  (existing `ctx.ui.setStatus`) remains the only feedback path. No regression.

## Migration Plan

1. Add `@blackbelt-technology/pi-dashboard-shared` as a devDependency in `package.json`
2. Create `dashboard-ui.ts` with `registerDashboardUi(pi)` and `invalidateDashboardUi(pi)`
3. Patch `dashboard-events.ts`: `emitStateUpdate` calls `invalidateDashboardUi(pi)` after the
   existing `pi.events.emit`
4. Patch `index.ts`: call `registerDashboardUi(pi)` after command registration
5. Commit — no migration of existing sessions needed (decorators are stateless / re-probed
   on every `session_start`)

Rollback: revert the four changed files; no data is written to disk by the new code.
