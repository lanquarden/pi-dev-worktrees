## 1. Emit openspec:directory_hint

- [x] 1.1 In `packages/pi-dev-worktrees/src/dashboard-events.ts`, add `emitOpenSpecDirectoryHint(pi, path)` helper that calls `pi.events.emit("openspec:directory_hint", { path })`
- [x] 1.2 Call `emitOpenSpecDirectoryHint(pi, path)` inside `emitWorkspaceCreated` after the existing `pi-dev-worktrees:workspace-created` emit
- [x] 1.3 Call `emitOpenSpecDirectoryHint(pi, path)` inside the branch+path variant of `emitWorkspaceSwitched` (the non-null path branch), after the existing emit — do NOT call it in the `worktree: null` off-variant

## 2. Tests

- [x] 2.1 Add test asserting `emitWorkspaceCreated` emits `openspec:directory_hint` with `{ path }` payload
- [x] 2.2 Add test asserting `emitWorkspaceSwitched` with valid branch+path emits `openspec:directory_hint`
- [x] 2.3 Add test asserting `emitWorkspaceSwitched` with null branch/path does NOT emit `openspec:directory_hint`
