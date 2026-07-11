# terminal-routing-feedback Specification

## Purpose

Restore compact per-command RTK and devcontainer routing awareness in plain pi while retaining the built-in footer, bash execution, and bash result rendering.

## ADDED Requirements

### Requirement: Plain pi SHALL show persistent composable routing state

The extension SHALL use `ctx.ui.setStatus` only for active devcontainer state. It SHALL NOT replace pi's full footer, repeat the package name, show worktree-disabled/external state, or retain an inactive status.

#### Scenario: Container starting
- **GIVEN** devcontainer startup is in progress
- **WHEN** TUI status is rendered
- **THEN** the visible extension status is `container:starting`
- **AND** it does not identify worktree ownership or the package name

#### Scenario: Container ready
- **GIVEN** devcontainer targeting is ready
- **WHEN** TUI status is rendered
- **THEN** the visible extension status is `container:on`

#### Scenario: No active container
- **GIVEN** no devcontainer is active, including when worktrees are disabled/external
- **WHEN** status is refreshed
- **THEN** the extension status slot is cleared

#### Scenario: Container transition refreshes status
- **GIVEN** a container transitions from starting to ready, off, or failed
- **WHEN** extension state changes
- **THEN** the same status entry is updated or cleared rather than adding a widget or notification per bash call

---

### Requirement: TUI bash calls SHALL use native, width-aware dispatch rendering

In TUI mode, the extension SHALL register a bash definition derived from pi's stock `createBashToolDefinition(sessionCwd)`, preserving stock execution and result rendering while replacing only `renderCall`. The original LLM command SHALL be left-justified and the themed dispatch-chip group SHALL be right-justified. Presentation metadata SHALL NOT be injected into executable command text.

#### Scenario: Container command rewritten by RTK
- **GIVEN** RTK rewrites a bash command
- **AND** the rewritten command will execute in a container with id `a1b2c3d4e5f6...`
- **WHEN** the routed call is rendered
- **THEN** the original LLM command is left-justified
- **AND** right-justified chips include `DEV a1b2c3d4e5f6` and `RTK`

#### Scenario: Managed worktree routing
- **GIVEN** this extension manages worktrees and routes the call to `state.worktree.path`
- **WHEN** the call is rendered
- **THEN** the right-justified chip group includes `CWD <worktree-path>`

#### Scenario: External worktree mode omits CWD
- **GIVEN** worktrees are disabled/external and the session cwd is authoritative
- **WHEN** a host or container call is rendered
- **THEN** no `CWD` chip is shown

#### Scenario: Host passthrough while container targeting is active
- **GIVEN** devcontainer targeting is active
- **AND** a git command is deliberately routed to the host
- **WHEN** the call is rendered
- **THEN** right-justified chips include `HOST`

#### Scenario: RTK attempted but container fallback executes original command
- **GIVEN** RTK rewrites a command
- **AND** RTK is unavailable inside the target container
- **WHEN** the call is rendered
- **THEN** right-justified chips include `RTK fallback`
- **AND** they do not imply the rewrite executed

#### Scenario: Routing error
- **GIVEN** routing resolves to an error
- **WHEN** the call is rendered
- **THEN** right-justified chips include a themed error indicator

#### Scenario: Ordinary host call remains stock
- **GIVEN** no devcontainer is configured
- **AND** RTK did not rewrite the command
- **AND** no managed-worktree cwd routing is active
- **WHEN** the call is rendered
- **THEN** no dispatch chips are added

#### Scenario: Narrow tool row
- **GIVEN** the command and chip group cannot fit on one line within the render width
- **WHEN** the call is rendered
- **THEN** no rendered line exceeds the supplied width
- **AND** the command remains left-justified on the first line
- **AND** chips are right-justified on a following line

---

### Requirement: Dispatch feedback SHALL distinguish attempted and executed RTK routing

Per-call metadata SHALL represent RTK as `none`, `applied`, or `fallback`. `applied` SHALL mean the rewritten command was passed into bash routing; `fallback` SHALL mean rewriting was detected but the original LLM command was passed into routing.

#### Scenario: No rewrite
- **GIVEN** original and post-RTK command strings are equal
- **THEN** RTK execution state is `none`

#### Scenario: Rewrite executes on host
- **GIVEN** original and post-RTK commands differ
- **AND** the rewritten command is routed to the host
- **THEN** RTK execution state is `applied`

#### Scenario: Rewrite cannot execute in container
- **GIVEN** original and post-RTK commands differ
- **AND** target-container RTK probing reports unavailable
- **THEN** RTK execution state is `fallback`

---

### Requirement: Native dispatch rendering SHALL be TUI-only and conflict-aware

The custom bash call renderer SHALL be registered only when `ctx.mode === "tui"`. Before registration, the extension SHALL inspect bash tool source metadata. If another non-built-in extension owns `bash`, this extension SHALL preserve event-based routing, leave that definition untouched, and emit one warning per session that native routing chips are unavailable.

#### Scenario: Compatible TUI registration
- **GIVEN** TUI mode and no non-built-in bash owner
- **WHEN** the session starts
- **THEN** the stock-derived wrapper is registered
- **AND** stock execute and renderResult behavior are preserved

#### Scenario: Conflicting bash owner
- **GIVEN** another extension owns the active `bash` definition
- **WHEN** this extension starts in TUI mode
- **THEN** it does not replace that definition
- **AND** command routing hooks remain active
- **AND** exactly one warning is shown for the session

#### Scenario: Dashboard session
- **GIVEN** `ctx.mode === "rpc"`
- **WHEN** a bash call is routed
- **THEN** no TUI renderer override is registered
- **AND** the existing `pi-dev-worktrees:bash-dispatch` event is still emitted

#### Scenario: Print or JSON session
- **GIVEN** mode is `print` or `json`
- **WHEN** a bash call is routed
- **THEN** no TUI renderer override or UI status method is required
- **AND** command routing still functions

---

### Requirement: Bash result grounding SHALL be correlated by toolCallId

The extension SHALL store dispatch metadata by `toolCallId` between `tool_call` and `tool_result`. A result SHALL consume only its matching metadata. Container results SHALL retain the `[container]` prefix. Host results SHALL retain `[host]` only when a devcontainer was configured for that call. Error results SHALL retain their self-explanatory error output.

#### Scenario: Parallel results complete out of order
- **GIVEN** bash call A routes to container and bash call B routes to host
- **AND** B completes before A
- **WHEN** both `tool_result` events are handled
- **THEN** B receives host grounding and A receives container grounding
- **AND** neither call consumes the other's metadata

#### Scenario: Metadata is consumed
- **GIVEN** dispatch metadata exists for a tool call
- **WHEN** its matching result is handled
- **THEN** that map entry is deleted

#### Scenario: Host-only session avoids noise
- **GIVEN** a call routes to host and no devcontainer was configured for that call
- **WHEN** its result is handled
- **THEN** `[host]` is not added

---

### Requirement: Existing dashboard feedback SHALL remain compatible

The extension SHALL continue emitting the existing bash-dispatch fields. Any RTK execution-state field SHALL be additive so an older dashboard plugin can ignore it.

#### Scenario: Existing dashboard consumer
- **GIVEN** a consumer understands `rtkRewritten`, `routing`, `containerId`, and `cwd` but not the new RTK execution state
- **WHEN** it receives a dispatch event
- **THEN** all existing fields retain their meanings
- **AND** the consumer can render its existing chips unchanged
