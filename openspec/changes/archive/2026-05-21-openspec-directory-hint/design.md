## Context

`pi-dev-worktrees` already emits `pi-dev-worktrees:workspace-created` and `pi-dev-worktrees:workspace-switched` via `pi.events.emit(...)` in `dashboard-events.ts`. These carry `{ type, branch, path, cwd }`. The `path` field is the worktree directory — exactly what the dashboard needs to start polling.

The dashboard defines `openspec:directory_hint` as the generic contract for this purpose. This change adds emission of that event alongside the existing workspace events.

## Goals / Non-Goals

**Goals:**
- Emit `openspec:directory_hint { path }` whenever a worktree is activated (created or switched to)
- Keep existing workspace event emission unchanged

**Non-Goals:**
- Implementing the server-side handler (that lives in `pi-agent-dashboard`)
- Emitting on `workspace-removed` or `workspace-off` (the server stops polling directories that have no active session and no pin — no cleanup needed)

## Decisions

### 1. Where to emit
**Decision**: Add `emitOpenSpecDirectoryHint` helper to `dashboard-events.ts` and call it from `emitWorkspaceCreated` and `emitWorkspaceSwitched` (only the branch+path variant, not the `worktree: null` off-variant).

**Rationale**: Co-locating the hint emission with the workspace events ensures they always fire together. The `worktree: null` case means the session reverted to the main repo root — which is already `session.cwd` and already polled.

### 2. Event payload
**Decision**: `{ path: string }` only. Do not include `branch`, `cwd`, or other fields.

**Rationale**: The server contract (`openspec:directory_hint`) only needs `path`. Keeping the payload minimal avoids coupling the emitter to server internals.

## Risks / Trade-offs

- **[No-op when dashboard absent]** `pi.events.emit(...)` is fire-and-forget. When no dashboard bridge is connected, the event is silently dropped. No error handling needed.
