# workspaces-modal Specification

## Purpose
TUI commands and dashboard modal for worktree management. The `/worktree` command handles all worktree lifecycle operations; the dashboard modal is triggered by `/worktree status`.

## Requirements

### Requirement: Management modal declared on ui:list-modules
When `ui:list-modules` is probed, the extension SHALL push a `management-modal` descriptor
with `id: "worktrees-table"`, `command: "/worktree status"`, and a `table` view so the
pi-agent-dashboard renders a structured modal when the user types `/worktree status` in the
dashboard chat input.

#### Scenario: Modal registered on probe
- **WHEN** `ui:list-modules` is emitted by the bridge
- **THEN** `probe.modules` contains a `management-modal` with `id "worktrees-table"` and
  `command "/worktree status"`
- **THEN** the view has `kind: "table"`, `dataEvent: "workspaces:list"`, and `rowKey: "branch"`
- **THEN** columns are: `branch` (text), `path` (text), `age` (text), `dirty` (boolean)

### Requirement: Worktree table data provided synchronously
When the bridge emits `workspaces:list` on `pi.events`, the extension SHALL populate
`data.items` synchronously with one row per worktree found under `.pi/worktrees/`.

#### Scenario: Worktrees present
- **WHEN** `workspaces:list` is emitted and `.pi/worktrees/` contains worktree directories
- **THEN** `data.items` contains one entry per worktree with `{ branch, path, age, dirty }` fields
- **THEN** `age` is formatted as `"today"` for mtime < 24h, `"<N>d ago"` otherwise
- **THEN** `dirty` is `true` if `git status --porcelain` in that directory returns any output

#### Scenario: No worktrees
- **WHEN** `workspaces:list` is emitted and `.pi/worktrees/` is absent or empty
- **THEN** `data.items` is an empty array

#### Scenario: wtp unavailable — graceful fallback
- **WHEN** `workspaces:list` is emitted and `wtp` is not on PATH
- **THEN** `data.items` is populated via directory enumeration (same `enumerateWorktreeDirs` logic)
- **THEN** no error is thrown

### Requirement: Per-row Remove action
The `management-modal` view SHALL declare a per-row `rowActions` entry:
`{ id: "remove", label: "Remove", variant: "danger", event: "workspaces:delete-row",
confirm: "Remove this worktree? Any uncommitted changes will be lost." }`.

#### Scenario: Remove action declared
- **WHEN** `ui:list-modules` is probed
- **THEN** `view.rowActions` contains exactly one action with `id: "remove"` and
  `event: "workspaces:delete-row"`
- **THEN** `confirm` is a non-empty string (dashboard will prompt before dispatching)

### Requirement: Delete-row handler removes the worktree
When `workspaces:delete-row` is emitted on `pi.events` the extension SHALL remove the
worktree identified by the `branch` field and refresh the modal.

#### Scenario: Remove clean worktree
- **WHEN** `workspaces:delete-row` fires with `{ branch: "feature/auth" }` and the worktree
  has no uncommitted changes
- **THEN** `wtp remove feature/auth` is executed
- **THEN** `pi.events.emit("ui:invalidate", ...)` is called so the modal and footer refresh
- **THEN** if the removed branch was the session's active worktree, `state.worktree` is cleared

#### Scenario: Remove dirty worktree
- **WHEN** `workspaces:delete-row` fires with `{ branch: "feature/auth" }` and the worktree
  has uncommitted changes (`dirty: true`)
- **THEN** `wtp remove --force feature/auth` is executed
- **THEN** subsequent behavior matches the clean-removal scenario

#### Scenario: Remove nonexistent worktree
- **WHEN** `workspaces:delete-row` fires with a `branch` that no longer exists on disk
- **THEN** the extension logs a warning and calls `ui:invalidate` without throwing

### Requirement: status sub-command on /worktree
The `/worktree` command SHALL accept `status` as a sub-command, replacing the removed `/workspaces` command.

#### Scenario: User runs /worktree status
- **WHEN** the user types `/worktree status` in the TUI
- **THEN** the extension displays the worktree and devcontainer snapshot

### Requirement: remove sub-command on /worktree with confirmation
The `/worktree` command SHALL accept `remove <branch>` as a sub-command, replacing the removed `/workspace-cleanup` command. The TUI path SHALL prompt for confirmation before removing.

#### Scenario: User runs /worktree remove with confirmation
- **WHEN** the user types `/worktree remove feature/auth` in the TUI
- **THEN** the extension prompts for confirmation before removing
- **THEN** if the user confirms, the worktree is removed and `git worktree prune` is run
- **THEN** if the user cancels, no changes are made

#### Scenario: Remove missing branch argument
- **WHEN** the user types `/worktree remove` without a branch name
- **THEN** the extension displays usage: `"Usage: /worktree remove <branch>"`

### Requirement: /workspaces and /workspace-cleanup removed
The standalone `/workspaces` and `/workspace-cleanup` commands SHALL be removed. Their functionality is fully covered by `/worktree status` and `/worktree remove`.

#### Scenario: Removed commands not registered
- **WHEN** the extension loads
- **THEN** no command named `workspaces` or `workspace-cleanup` is registered via `pi.registerCommand()`

### Requirement: bare branch form preserved on /worktree
The `/worktree <branch>` form (without an explicit `set` sub-command) SHALL continue to work as the default action.

#### Scenario: Bare branch switches worktree
- **WHEN** the user types `/worktree feature/auth`
- **THEN** the extension creates or switches to the worktree for `feature/auth` (same as `/worktree set feature/auth`)

#### Scenario: Explicit set also works
- **WHEN** the user types `/worktree set feature/auth`
- **THEN** the result is identical to the bare-branch form
