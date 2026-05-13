## ADDED Requirements

### Requirement: Footer segment registered on ui:list-modules
When the pi-agent-dashboard bridge emits `ui:list-modules`, the extension SHALL push a
`footer-segment` descriptor (namespace `"pi-worktrees"`, id `"workspace-state"`) into
`probe.modules` if the session has an active worktree or devcontainer. If neither is active,
the extension SHALL push the same descriptor with `removed: true` to clear any previously
displayed segment.

#### Scenario: Active worktree only
- **WHEN** `state.worktree` is set and `state.devcontainer.enabled` is false
- **THEN** `probe.modules` contains a `footer-segment` with `payload.text = "⎇ <branch>"`
  where `<branch>` is truncated to 20 characters with `…` suffix if longer

#### Scenario: Active devcontainer only — running
- **WHEN** `state.worktree` is undefined and `state.devcontainer.enabled` is true and `starting` is false
- **THEN** `probe.modules` contains a `footer-segment` with `payload.text = "🐳 on"`

#### Scenario: Active devcontainer only — starting
- **WHEN** `state.worktree` is undefined and `state.devcontainer.enabled` is true and `starting` is true
- **THEN** `probe.modules` contains a `footer-segment` with `payload.text = "🐳 starting…"`

#### Scenario: Both worktree and running devcontainer active
- **WHEN** `state.worktree` is set and `state.devcontainer.enabled` is true and `starting` is false
- **THEN** `probe.modules` contains a `footer-segment` with `payload.text = "⎇ <branch>  🐳 on"`

#### Scenario: Both worktree and starting devcontainer active
- **WHEN** `state.worktree` is set and `state.devcontainer.enabled` is true and `starting` is true
- **THEN** `probe.modules` contains a `footer-segment` with `payload.text = "⎇ <branch>  🐳 starting…"`

#### Scenario: Neither active — removal
- **WHEN** `state.worktree` is undefined and `state.devcontainer` is undefined or disabled
- **THEN** `probe.modules` contains a `footer-segment` descriptor with `removed: true`

### Requirement: Footer segment refreshes on state mutation
After any worktree or devcontainer state change, the extension SHALL emit `ui:invalidate`
on `pi.events` so the bridge re-probes and the updated `footer-segment` reaches the dashboard.

#### Scenario: Worktree activated
- **WHEN** `/worktree <branch>` succeeds and `emitStateUpdate` is called
- **THEN** `pi.events.emit("ui:invalidate", { id: "workspace-state" })` is called

#### Scenario: Worktree disabled
- **WHEN** `/worktree off` succeeds and `emitStateUpdate` is called
- **THEN** `pi.events.emit("ui:invalidate", { id: "workspace-state" })` is called

#### Scenario: Devcontainer state changes
- **WHEN** devcontainer enabled, starts, or is disabled and `emitStateUpdate` is called
- **THEN** `pi.events.emit("ui:invalidate", { id: "workspace-state" })` is called

### Requirement: No-dashboard fallback
When no pi-agent-dashboard bridge is connected, `ui:list-modules` is never emitted and
`ui:invalidate` calls SHALL be silently ignored. The TUI status bar (`ctx.ui.setStatus`)
SHALL continue to be the sole feedback path.

#### Scenario: Dashboard not connected
- **WHEN** the extension runs in a plain pi TUI session with no bridge
- **THEN** no error is thrown and all commands function normally
- **THEN** `ctx.ui.setStatus` still reflects the active workspace state
