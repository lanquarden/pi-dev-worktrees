## ADDED Requirements

### Requirement: worktree_set tool registered
The extension SHALL register a `worktree_set` tool via `pi.registerTool()` that creates or switches to a wtp-managed worktree, or deactivates worktree routing when called with `"off"`, or prunes stale metadata when called with `"prune"`.

#### Scenario: LLM calls worktree_set with a branch name
- **WHEN** the LLM invokes `worktree_set` with `{ "branch": "feature/auth" }`
- **THEN** the extension creates or switches to the worktree for `feature/auth`
- **THEN** subsequent bash tool calls are prefixed with `cd <worktree-path> &&`

#### Scenario: LLM calls worktree_set with "off"
- **WHEN** the LLM invokes `worktree_set` with `{ "branch": "off" }`
- **THEN** worktree routing is deactivated

#### Scenario: LLM calls worktree_set with "prune"
- **WHEN** the LLM invokes `worktree_set` with `{ "branch": "prune" }`
- **THEN** `git worktree prune` is executed to clear stale metadata

### Requirement: devcontainer_control tool registered
The extension SHALL register a `devcontainer_control` tool via `pi.registerTool()` that accepts an `action` parameter of `"on"`, `"off"`, or `"rebuild"` and performs the corresponding devcontainer lifecycle operation.

#### Scenario: LLM calls devcontainer_control with "on"
- **WHEN** the LLM invokes `devcontainer_control` with `{ "action": "on" }`
- **THEN** the devcontainer is started (equivalent to `/workspace on`)
- **THEN** subsequent bash tool calls are routed through `devcontainer exec`

#### Scenario: LLM calls devcontainer_control with "off"
- **WHEN** the LLM invokes `devcontainer_control` with `{ "action": "off" }`
- **THEN** container routing is deactivated

#### Scenario: LLM calls devcontainer_control with "rebuild"
- **WHEN** the LLM invokes `devcontainer_control` with `{ "action": "rebuild" }`
- **THEN** the container is rebuilt with `--no-cache`

### Requirement: workspaces_status tool registered
The extension SHALL register a `workspaces_status` tool via `pi.registerTool()` that returns a snapshot of all active worktrees and current container status.

#### Scenario: LLM calls workspaces_status
- **WHEN** the LLM invokes `workspaces_status` with no parameters
- **THEN** the tool returns a structured list of active worktrees with branch, path, age, and dirty status
- **THEN** current devcontainer routing state is included in the response

### Requirement: workspace_remove tool registered
The extension SHALL register a `workspace_remove` tool via `pi.registerTool()` that removes a worktree by branch name.

#### Scenario: LLM calls workspace_remove
- **WHEN** the LLM invokes `workspace_remove` with `{ "branch": "feature/auth" }`
- **THEN** the worktree for `feature/auth` is removed
- **THEN** `git worktree prune` is run to clear any stale metadata

### Requirement: Tools callable in a single LLM turn
All four registered tools SHALL be callable by the LLM in the same turn as other tool calls, allowing setup (worktree + devcontainer) and task work to be chained in a single prompt without orchestration polling.

#### Scenario: Single-prompt setup and task
- **WHEN** a prompt instructs the LLM to set up a worktree, enable devcontainer, and then run tests
- **THEN** the LLM MAY call `worktree_set`, `devcontainer_control`, and `bash` in sequence within a single agentic run
- **THEN** no external polling or sequential prompts are required from the caller
