## ADDED Requirements

### Requirement: `createOrTargetWorktree` SHALL return hook output
`createOrTargetWorktree` SHALL return `{ path: string; hookOutput: string }` instead of
`string`, where `hookOutput` is the combined stdout+stderr of the `wtp add` invocation,
trimmed. When the worktree already exists and no `wtp add` call was made, `hookOutput`
SHALL be `""`.

#### Scenario: New worktree with hooks
- **WHEN** `.wtp.yml` defines one or more `post_create` hooks and the worktree path does not yet exist
- **THEN** `wtp add` is called and its full stdout+stderr is captured
- **THEN** the returned `hookOutput` is the captured text, trimmed
- **THEN** the returned `path` is the absolute worktree path

#### Scenario: Existing worktree
- **WHEN** `createOrTargetWorktree` is called for a worktree path that already exists on disk
- **THEN** `hookOutput` is `""` (no `wtp add` was run)
- **THEN** `path` is the existing worktree path

#### Scenario: Hook failure propagates output
- **WHEN** `wtp add` exits non-zero
- **THEN** `createOrTargetWorktree` throws an `Error` whose message includes the captured stdout+stderr

---

### Requirement: `/worktree <branch>` SHALL show hook output after creation
When a new worktree is created via `/worktree <branch>`, the extension SHALL call a
second `ctx.ui.notify` with the hook progress output at `"info"` severity when
`hookOutput` is non-empty.

#### Scenario: First-time worktree creation with hooks
- **WHEN** `/worktree feature/auth` is run and the worktree is newly created with hooks defined
- **THEN** the user sees two notifications: the worktree-active message, then the hook output

#### Scenario: Re-activating an existing worktree
- **WHEN** `/worktree feature/auth` is run and the worktree already exists
- **THEN** only the worktree-active notification is shown (hookOutput is empty)
