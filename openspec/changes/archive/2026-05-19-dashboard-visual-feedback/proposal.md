## Why

The `pi-dev-worktrees` extension manages git worktrees and devcontainers per session, but its
state (active branch, container status) is only visible inside the pi TUI status bar.
The pi-agent-dashboard session cards show no workspace context, making it hard to tell at
a glance which worktree or container each session is using. Now that `useRpcKeeper` is
enabled for slash-command dispatch, the last remaining gap is visual feedback in the
dashboard cards themselves.

## What Changes

- **New `footer-segment` decorator**: each session card's header gains a right-side segment
  showing the active worktree branch and/or container state (e.g. `⎇ feature/auth | 🐳 on`).
  Updates live whenever state changes via `ui:invalidate`.
- **New `management-modal` for `/workspaces`**: the `/workspaces` slash command gains a
  dashboard-native table modal listing all worktrees (branch, path, age, dirty flag, active
  marker) with a per-row **Remove** action. Replaces the plain-text `ctx.ui.notify` output
  with a structured UI when viewed from the dashboard.
- **`ui:invalidate` emit on all state mutations**: every worktree and devcontainer state
  change already calls `emitStateUpdate()`; that helper gains a `pi.events.emit("ui:invalidate")`
  call so the decorator and modal stay in sync.
- **New `dashboard-ui.ts` module**: all `ui:list-modules` listener logic, data handlers, and
  invalidation helpers extracted to a dedicated file; `index.ts` calls `registerDashboardUi(pi)`
  once on startup.
- **No new npm dependencies**: the dashboard types live in
  `@blackbelt-technology/pi-dashboard-shared` (already available as a peer via the bridge);
  the extension uses plain `pi.events` — no SDK import required.

## Capabilities

### New Capabilities

- `session-card-decoration`: footer-segment decorator that surfaces active worktree branch
  and devcontainer state directly on the pi-agent-dashboard session card. Registers on the
  `ui:list-modules` probe; removes itself when both worktree and devcontainer are inactive.
- `workspaces-modal`: management-modal wired to `/workspaces` that renders a table of all
  worktrees under `.pi/worktrees/` with columns (branch, path, age, dirty) and a per-row
  Remove action backed by `wtp remove`. Handles `ui_management` list/delete-row round-trips
  via `pi.events`.

### Modified Capabilities

_(none — no existing spec-level requirements change)_

## Impact

- **`index.ts`**: import and call `registerDashboardUi(pi)` in the extension entry point;
  `emitStateUpdate()` in `dashboard-events.ts` gains one `pi.events.emit("ui:invalidate")`
  call.
- **New `dashboard-ui.ts`**: `registerDashboardUi(pi)` attaches the `ui:list-modules`
  listener, the `workspaces:list` and `workspaces:delete-row` event handlers, and exposes
  `invalidateDashboardUi(pi)` for callers.
- **`dashboard-events.ts`**: `emitStateUpdate()` calls `invalidateDashboardUi(pi)` after
  the existing `pi.events.emit("pi-dev-worktrees:state", ...)`.
- No changes to `session.ts`, `worktrees.ts`, `devcontainer.ts`, or `bash-intercept.ts`.
- No new runtime dependencies; `@blackbelt-technology/pi-dashboard-shared` added as a
  devDependency for types only (already transitively present via the bridge extension).
