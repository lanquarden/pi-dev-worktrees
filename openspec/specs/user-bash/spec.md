# user-bash Specification

## Purpose
TBD - created by archiving change rtk-interop-setup. Update Purpose after archive.
## Requirements
### Requirement: `user_bash` handler SHALL apply worktree and container routing

`pi-dev-worktrees` SHALL register a `user_bash` event handler that applies the same routing decision table as `applyBashIntercept` to user `!<cmd>` commands.

#### Scenario: worktree active, no container — `!<cmd>` gets cd prefix
- **WHEN** a user runs `!npm test`
- **AND** a worktree is active (`state.worktree.path` is set)
- **AND** no devcontainer is enabled
- **THEN** the command executes as `cd '<worktree-path>' || { ... }; npm test`
- **THEN** the result is included in model context (normal `!` behaviour preserved)

#### Scenario: container active — `!<cmd>` routes through devcontainer exec
- **WHEN** a user runs `!npm test`
- **AND** devcontainer is enabled and running
- **THEN** the command executes as `devcontainer exec ... -- sh -c 'cd <workspace> && npm test'`

#### Scenario: `!!<cmd>` is NOT intercepted
- **WHEN** a user runs `!!npm test` (`event.excludeFromContext === true`)
- **THEN** `pi-dev-worktrees` returns `undefined` from the `user_bash` handler
- **THEN** pi handles the command normally without routing

#### Scenario: `HOST:` prefix bypasses routing
- **WHEN** a user runs `!HOST:npm test`
- **THEN** the `HOST:` prefix is stripped and the command runs on the host without any worktree or container wrapping

#### Scenario: no worktree and no container — passthrough
- **WHEN** a user runs `!npm test`
- **AND** no worktree is active and no container is enabled
- **THEN** the command runs unchanged on the host

