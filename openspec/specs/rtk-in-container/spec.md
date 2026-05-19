# rtk-in-container Specification

## Purpose
TBD - created by archiving change rtk-interop-setup. Update Purpose after archive.
## Requirements
### Requirement: RTK-in-container SHALL be probed at container-ready and advisory emitted

When `pi-rtk-optimizer` is detected and the devcontainer becomes ready, `pi-dev-worktrees` SHALL probe for `rtk` availability inside the container and notify the user if absent.

#### Scenario: container becomes ready, `pi-rtk-optimizer` loaded, `rtk` present in container
- **WHEN** `state.devcontainer.starting` transitions to `false`
- **AND** `pi-rtk-optimizer` is detected (a `/rtk` command is registered)
- **AND** `devcontainer exec ... -- rtk --version` exits 0
- **THEN** `containerRtkAvailable` is set to `true`
- **THEN** no notification is emitted

#### Scenario: container becomes ready, `pi-rtk-optimizer` loaded, `rtk` absent from container
- **WHEN** `state.devcontainer.starting` transitions to `false`
- **AND** `pi-rtk-optimizer` is detected
- **AND** `devcontainer exec ... -- rtk --version` fails
- **THEN** `containerRtkAvailable` is set to `false`
- **THEN** `ctx.ui.notify` is called once at `"info"` severity with a message explaining that `rtk` is not found in the container, that rewritten commands containing `| rtk compress` will fail, and providing the `postCreateHooks` copy snippet as the recommended fix

#### Scenario: container becomes ready, `pi-rtk-optimizer` not loaded
- **WHEN** `state.devcontainer.starting` transitions to `false`
- **AND** no `/rtk` command is registered
- **THEN** no container probe is run
- **THEN** no notification is emitted

#### Scenario: advisory is emitted at most once per container session
- **WHEN** the container is restarted via `/devcontainer off` then `/devcontainer on`
- **THEN** the probe runs again at the new container-ready transition
- **THEN** the advisory may emit again if `rtk` is still absent (not suppressed across restarts)

