## RENAMED Requirements

### Requirement: Workspace command renamed
RENAMED:
- FROM: `/worktree [branch | off | prune]` slash command
- TO: `/workspace [branch | off | prune]` slash command

### Requirement: Workspace cleanup command renamed
RENAMED:
- FROM: `/workspace-cleanup` slash command
- TO: `/workspace-remove` slash command

## MODIFIED Requirements

### Requirement: Management modal declared on ui:list-modules
When `ui:list-modules` is probed, the extension SHALL push a `management-modal` descriptor
with `id: "worktrees-table"`, `command: "/workspaces"`, and a `table` view so the
pi-agent-dashboard renders a structured modal when the user types `/workspaces` in the
dashboard chat input.

#### Scenario: Modal registered on probe
- **WHEN** `ui:list-modules` is emitted by the bridge
- **THEN** `probe.modules` contains a `management-modal` with `id "worktrees-table"` and
  `command "/workspaces"`
- **THEN** the view has `kind: "table"`, `dataEvent: "workspaces:list"`, and `rowKey: "branch"`
- **THEN** columns are: `branch` (text), `path` (text), `age` (text), `dirty` (boolean)

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
