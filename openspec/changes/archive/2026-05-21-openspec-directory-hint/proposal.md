## Why

The `pi-dev-worktrees` extension creates git worktrees mid-session and routes bash commands there. The dashboard's OpenSpec plugin is unaware of these directories because OpenSpec polling is keyed by `session.cwd` (the main repo root), not the active worktree path. This change makes `pi-dev-worktrees` emit `openspec:directory_hint` whenever a worktree is activated so the dashboard starts polling the correct directory.

This is the emitter side of the `openspec:directory_hint` contract defined in `pi-agent-dashboard`. This change only adds event emission — no server-side logic lives here.

## What Changes

- **Emit `openspec:directory_hint`** in `dashboard-events.ts` alongside the existing `workspace-created` and `workspace-switched` events, passing the worktree `path` as payload.

## Capabilities

### New Capabilities

- `openspec-directory-hint-emit`: When `emitWorkspaceCreated` or `emitWorkspaceSwitched` is called with a valid `path`, also emit `openspec:directory_hint { path }` so the dashboard server adds the worktree to its OpenSpec poll set.

### Modified Capabilities

_(none)_

## Impact

- **Files**: `packages/pi-dev-worktrees/src/dashboard-events.ts`
- **Tests**: `packages/pi-dev-worktrees/tests/bash-dispatch-emit.test.ts` (or a new `dashboard-events.test.ts`)
- **Protocol**: Depends on `openspec:directory_hint` contract from `pi-agent-dashboard`. No new protocol defined here.
