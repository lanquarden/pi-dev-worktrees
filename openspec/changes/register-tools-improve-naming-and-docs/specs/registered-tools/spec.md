## ADDED Requirements

### Requirement: worktree tool registered
The extension SHALL register a `worktree` tool via `pi.registerTool()` with an `action` parameter (`"set"` | `"off"` | `"prune"` | `"status"` | `"remove"`) and an optional `branch` string parameter.

#### Scenario: LLM calls worktree with action "set"
- **WHEN** the LLM invokes `worktree` with `{ "action": "set", "branch": "feature/auth" }`
- **THEN** the extension creates or switches to the worktree for `feature/auth`
- **THEN** subsequent bash tool calls are prefixed with `cd <worktree-path> &&`

#### Scenario: LLM calls worktree with action "off"
- **WHEN** the LLM invokes `worktree` with `{ "action": "off" }`
- **THEN** worktree routing is deactivated

#### Scenario: LLM calls worktree with action "prune"
- **WHEN** the LLM invokes `worktree` with `{ "action": "prune" }`
- **THEN** `git worktree prune` is executed to clear stale metadata

#### Scenario: LLM calls worktree with action "status"
- **WHEN** the LLM invokes `worktree` with `{ "action": "status" }`
- **THEN** the tool returns a snapshot of all active worktrees and devcontainer state

#### Scenario: LLM calls worktree with action "remove"
- **WHEN** the LLM invokes `worktree` with `{ "action": "remove", "branch": "feature/auth" }`
- **THEN** the worktree for `feature/auth` is removed without a confirmation prompt (LLM is responsible for intent)
- **THEN** `git worktree prune` is run after removal

#### Scenario: Invalid action rejected
- **WHEN** the LLM invokes `worktree` with an `action` value not in the enum
- **THEN** the tool returns an error before `execute()` runs (TypeBox schema validation)

### Requirement: devcontainer tool registered
The extension SHALL register a `devcontainer` tool via `pi.registerTool()` with an `action` parameter (`"on"` | `"off"` | `"rebuild"` | `"logs"`).

#### Scenario: LLM calls devcontainer with action "on"
- **WHEN** the LLM invokes `devcontainer` with `{ "action": "on" }`
- **THEN** the devcontainer is started and subsequent bash tool calls are routed through `devcontainer exec`

#### Scenario: LLM calls devcontainer with action "off"
- **WHEN** the LLM invokes `devcontainer` with `{ "action": "off" }`
- **THEN** container routing is deactivated

#### Scenario: LLM calls devcontainer with action "rebuild"
- **WHEN** the LLM invokes `devcontainer` with `{ "action": "rebuild" }`
- **THEN** the container is rebuilt with `--no-cache`

### Requirement: Tools callable in a single LLM turn
Both registered tools SHALL be callable by the LLM in the same turn as other tool calls, allowing worktree setup, devcontainer activation, and task work to be chained in a single prompt.

#### Scenario: Single-prompt setup and task
- **WHEN** a prompt instructs the LLM to set up a worktree, enable devcontainer, and then run tests
- **THEN** the LLM MAY call `worktree`, `devcontainer`, and `bash` in sequence within a single agentic run without external polling

### Requirement: Shared operation helpers extracted
The extension SHALL extract the core logic for each operation into internal helper functions (`doWorktreeSet`, `doWorktreeRemove`, `doWorktreeStatus`, `doDevcontainerAction`, etc.) that are called from both the slash command handler and the tool `execute()` function.

#### Scenario: No logic duplication
- **WHEN** both the `/worktree set` command and the `worktree` tool with `action: "set"` are invoked with the same branch
- **THEN** they produce identical state changes by delegating to the same helper function
