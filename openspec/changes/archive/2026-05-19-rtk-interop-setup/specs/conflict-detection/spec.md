## ADDED Requirements

### Requirement: conflict detection SHALL run at `session_start`

At `session_start`, `pi-dev-worktrees` SHALL inspect loaded extensions for known incompatible configurations.

#### Scenario: `@sherif-fanous/pi-rtk` detected
- **WHEN** `pi.getAllTools()` returns a `bash` tool whose `sourceInfo.path` contains `pi-rtk` but not `pi-rtk-optimizer` and not `pi-dev-worktrees`
- **THEN** `ctx.ui.notify` is called at `"warning"` severity with a message identifying the conflicting extension, explaining that `spawnHook`-based extensions receive the devcontainer exec wrapper rather than the inner command, and naming `pi-rtk-optimizer` as the correct alternative

#### Scenario: unknown bash tool override detected
- **WHEN** `pi.getAllTools()` returns a `bash` tool whose `sourceInfo.path` does not belong to `pi-dev-worktrees` and does not match any known compatible extension
- **THEN** `ctx.ui.notify` is called at `"warning"` severity noting that the bash tool has been overridden and may interfere with worktree/container routing

#### Scenario: `pi-rtk-optimizer` detected, load order unverified
- **WHEN** `pi.getCommands()` contains a command named `"rtk"` (indicating `pi-rtk-optimizer` is loaded)
- **AND** the `bash` tool is held by the built-in (not overridden by either extension)
- **THEN** `ctx.ui.notify` is called at `"info"` severity with a message advising the user to verify load order via the `settings.json` `extensions` array, including the correct snippet

#### Scenario: no RTK extension detected
- **WHEN** neither an incompatible bash tool override nor a `/rtk` command is found
- **THEN** no notification is emitted
