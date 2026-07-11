# external-worktree-mode Specification

## Purpose

Allow an external orchestrator such as Herdr to own worktrees while this extension independently provides devcontainer routing from the pi session cwd.

## ADDED Requirements

### Requirement: Global config SHALL independently control worktrees and devcontainers

`PluginConfig` SHALL accept optional `worktrees.enabled` and `devcontainer.enabled`. Each capability SHALL be enabled when its field or parent object is absent and disabled only by explicit `false`. A config containing `{ "worktrees": { "enabled": false }, "devcontainer": { "enabled": true } }` SHALL be valid; `repos` SHALL be optional and treated as an empty array by repo resolvers.

#### Scenario: Existing config preserves both defaults
- **GIVEN** config contains only a `repos` array
- **WHEN** capability flags are resolved
- **THEN** extension-owned worktrees remain enabled
- **AND** devcontainers remain enabled

#### Scenario: Herdr with devcontainers
- **GIVEN** config is `{ "worktrees": { "enabled": false }, "devcontainer": { "enabled": true } }`
- **WHEN** the extension starts
- **THEN** extension-owned worktrees are disabled
- **AND** devcontainers remain enabled
- **AND** omission of `repos` does not throw

#### Scenario: Devcontainers explicitly disabled
- **GIVEN** config contains `{ "devcontainer": { "enabled": false } }`
- **WHEN** the extension starts
- **THEN** devcontainer initialization, restored targeting, command routing, tool exposure, and lifecycle operations are disabled
- **AND** worktrees retain their independently configured/default state

#### Scenario: Missing config preserves current behavior
- **GIVEN** the config file is absent or invalid
- **WHEN** the extension starts
- **THEN** extension-owned worktrees remain enabled
- **AND** devcontainers remain enabled

---

### Requirement: Disabled devcontainer capability SHALL have no side effects

When `devcontainer.enabled` is false, restored devcontainer state SHALL be cleared without stopping any container. The extension SHALL skip config discovery, generated devcontainer artifacts, probes, RTK-in-container checks, bash container routing, context injection, and lifecycle calls. The `devcontainer` LLM tool SHALL be inactive, and `/devcontainer` plus defensive tool invocations SHALL return a non-mutating disabled-by-config response.

#### Scenario: Disabled startup
- **GIVEN** `devcontainer.enabled` is false and restored state targets a container
- **WHEN** the session starts
- **THEN** restored devcontainer state is cleared and persisted
- **AND** no container is stopped, probed, started, or routed into

#### Scenario: Devcontainer tool removed
- **GIVEN** `devcontainer.enabled` is false
- **WHEN** active tools are refreshed
- **THEN** `devcontainer` is absent from `pi.getActiveTools()`
- **AND** unrelated active tools are preserved

#### Scenario: Slash command remains explanatory
- **GIVEN** `devcontainer.enabled` is false
- **WHEN** any `/devcontainer` action is invoked
- **THEN** no container or repository mutation occurs
- **AND** feedback states that devcontainers are disabled by config

---

### Requirement: Session cwd SHALL be distinct from Git and devcontainer roots

On every `session_start`, the extension SHALL capture `ctx.cwd` as the non-persisted `sessionCwd`. It SHALL resolve `gitRoot` relative to that cwd. In managed mode, `devcontainerRoot` SHALL be `gitRoot`; in external mode, `devcontainerRoot` SHALL be the exact `sessionCwd`.

#### Scenario: Herdr starts pi in a selected worktree
- **GIVEN** `ctx.cwd = "/repos/project-feature"`
- **AND** worktrees are externally managed
- **WHEN** the session starts
- **THEN** `devcontainerRoot` is `"/repos/project-feature"`

#### Scenario: Pi starts below the Git top-level in external mode
- **GIVEN** `ctx.cwd = "/repos/project-feature/packages/api"`
- **AND** `git rev-parse --show-toplevel` returns `"/repos/project-feature"`
- **WHEN** the session starts in external mode
- **THEN** `devcontainerRoot` remains `"/repos/project-feature/packages/api"`

#### Scenario: Managed mode preserves existing root behavior
- **GIVEN** worktrees are managed by the extension
- **WHEN** the session starts in a Git repository
- **THEN** `devcontainerRoot` equals `gitRoot`

---

### Requirement: External mode SHALL perform no extension-owned worktree operations

When worktrees are externally managed, the extension SHALL NOT generate or read `.wtp.yml`, invoke `wtp`, create/switch/remove/prune worktrees, rewrite bash cwd to `state.worktree.path`, rewrite relative read/write/edit paths, or expose dashboard worktree management actions. The `worktree` LLM tool SHALL be inactive. The `/worktree` command and any defensive invocation of the tool SHALL return an explanatory non-mutating response.

#### Scenario: Session startup has no worktree side effects
- **GIVEN** worktrees are externally managed
- **WHEN** the session starts
- **THEN** `.wtp.yml` is neither created nor read
- **AND** no `wtp` process is invoked

#### Scenario: Relative file tool remains relative to pi
- **GIVEN** external mode and stale restored `state.worktree.path`
- **WHEN** a relative `read`, `write`, or `edit` call is intercepted
- **THEN** its path is not rewritten by this extension

#### Scenario: Worktree command is non-mutating
- **GIVEN** external mode
- **WHEN** `/worktree set feature/x`, `remove`, `prune`, `init`, `hooks`, `off`, or `status` is invoked
- **THEN** no Git, wtp, file, or persisted worktree mutation occurs
- **AND** feedback states that worktrees are externally managed

#### Scenario: LLM tool is removed
- **GIVEN** external mode
- **WHEN** active tools are refreshed at session start
- **THEN** `worktree` is absent from `pi.getActiveTools()`
- **AND** all previously active unrelated tools remain active

#### Scenario: Dashboard omits worktree management
- **GIVEN** external mode and a dashboard bridge
- **WHEN** `ui:list-modules` is emitted
- **THEN** no worktree management modal is contributed
- **AND** devcontainer feedback may still be contributed

---

### Requirement: Restored state SHALL be sanitized before routing

In external mode, restored `state.worktree` SHALL be cleared before routing, context injection, status, or dashboard updates. When restored enabled devcontainer state does not align with `devcontainerRoot` or its expected transparent mount, the extension SHALL automatically reconcile targeting at the session cwd.

#### Scenario: Stale worktree state is cleared
- **GIVEN** restored state contains an extension-owned worktree
- **AND** config now selects external mode
- **WHEN** session startup restores state
- **THEN** `state.worktree` is cleared and sanitized state is persisted
- **AND** no subsequent tool call uses the stale path

#### Scenario: Restored devcontainer belongs to another cwd
- **GIVEN** restored enabled devcontainer workspace is `"/repos/old"`
- **AND** `devcontainerRoot` is `"/repos/current"`
- **WHEN** the session starts
- **THEN** targeting state is changed to `"/repos/current"` with `starting: true`
- **AND** a container is probed or started for `"/repos/current"`
- **AND** the differently rooted old container is not stopped
- **AND** UI-capable modes are notified that targeting is restarting for the session cwd

#### Scenario: Current-root container mount does not align
- **GIVEN** restored workspace equals `devcontainerRoot`
- **AND** the recorded or probed workspace mount does not transparently map the session cwd
- **WHEN** the session starts
- **THEN** the mismatched current-root container is stopped
- **AND** its override is regenerated
- **AND** startup uses `--remove-existing-container` for `devcontainerRoot`

#### Scenario: Restored devcontainer matches cwd and mount
- **GIVEN** restored devcontainer workspace and mount align with `devcontainerRoot`
- **WHEN** the session starts
- **THEN** targeting remains enabled and is probed using `devcontainerRoot`

#### Scenario: Reconciliation has no local config
- **GIVEN** restored targeting requires reconciliation
- **AND** no devcontainer config exists at `devcontainerRoot`
- **WHEN** the session starts
- **THEN** targeting is disabled
- **AND** UI-capable modes receive the same not-found diagnostic as `/devcontainer on`

---

### Requirement: Every devcontainer lifecycle operation SHALL use devcontainerRoot

Config discovery, override generation, logs, startup outcome, probe, Docker label lookup, start, exec, stop, rebuild, and log display SHALL all use the same `devcontainerRoot`. In external mode, devcontainer operations SHALL not require a Git repository.

#### Scenario: Start from external workspace
- **GIVEN** external mode and `sessionCwd = "/repos/project-feature"`
- **WHEN** `/devcontainer on` starts a container
- **THEN** config is discovered under `"/repos/project-feature"`
- **AND** `devcontainer up` receives `--workspace-folder "/repos/project-feature"`
- **AND** the override and startup log are under `"/repos/project-feature/.pi"`
- **AND** persisted `state.devcontainer.workspace` is `"/repos/project-feature"`

#### Scenario: Probe and exec use the same workspace
- **GIVEN** a container was started from `devcontainerRoot`
- **WHEN** readiness is probed and a bash command is routed
- **THEN** probe, label fallback, and workspace-folder exec fallback all use that same root

#### Scenario: External non-Git directory
- **GIVEN** external mode, a valid devcontainer config in `sessionCwd`, and no Git repository
- **WHEN** `/devcontainer on` is invoked
- **THEN** the container may start from `sessionCwd`
- **AND** no "Not in a git repository" error is returned

---

### Requirement: Agent context and status SHALL omit disabled worktree state

In external mode, `before_agent_start` SHALL omit claims that this extension selected or routes into a worktree. The composable extension status SHALL never identify external/disabled worktrees and SHALL show only active devcontainer state.

#### Scenario: External mode with ready container
- **GIVEN** external mode and a ready devcontainer
- **WHEN** status and agent context are built
- **THEN** visible status is `container:on`
- **AND** status does not mention worktrees or the package name
- **AND** agent context describes container routing rooted at the session workspace
- **AND** agent context does not claim an extension-owned branch or worktree path

#### Scenario: External mode without container
- **GIVEN** external mode and no active devcontainer
- **WHEN** status is built
- **THEN** the extension status slot is cleared
- **AND** no worktree-disabled/external indicator is shown
