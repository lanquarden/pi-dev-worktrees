## ADDED Requirements

### Requirement: Emit openspec:directory_hint on worktree activation
`dashboard-events.ts` SHALL emit `openspec:directory_hint { path }` via `pi.events.emit(...)` whenever `emitWorkspaceCreated` or `emitWorkspaceSwitched` is called with a non-null, non-empty `path`.

#### Scenario: Worktree created emits hint
- **WHEN** `emitWorkspaceCreated(pi, branch, path, cwd)` is called with a valid `path`
- **THEN** `pi.events.emit("openspec:directory_hint", { path })` is called
- **AND** the existing `pi-dev-worktrees:workspace-created` event is still emitted

#### Scenario: Worktree switched emits hint
- **WHEN** `emitWorkspaceSwitched(pi, branch, path, cwd)` is called with non-null `branch` and `path`
- **THEN** `pi.events.emit("openspec:directory_hint", { path })` is called
- **AND** the existing `pi-dev-worktrees:workspace-switched` event is still emitted

#### Scenario: Worktree off does NOT emit hint
- **WHEN** `emitWorkspaceSwitched(pi, null, null, cwd)` is called (the off-variant)
- **THEN** `pi.events.emit("openspec:directory_hint", ...)` is NOT called

#### Scenario: Hint payload contains only path
- **WHEN** `openspec:directory_hint` is emitted
- **THEN** the payload is exactly `{ path: string }` with no additional fields
