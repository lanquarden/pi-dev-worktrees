## ADDED Requirements

### Requirement: `buildStartArgs` SHALL accept a `noCache` parameter
`buildStartArgs(projectRoot, overridePath, removeExisting, noCache?)` SHALL accept an
optional boolean `noCache` parameter (default `false`). When `noCache` is `true`, the
string `"--no-cache"` SHALL be appended to the returned args array.

#### Scenario: noCache false (default)
- **WHEN** `buildStartArgs` is called without `noCache` or with `noCache = false`
- **THEN** the returned array does NOT contain `"--no-cache"`
- **THEN** existing behaviour is unchanged

#### Scenario: noCache true
- **WHEN** `buildStartArgs` is called with `noCache = true`
- **THEN** the returned array contains `"--no-cache"`
- **THEN** `"--no-cache"` appears after `"--remove-existing-container"` when both are set

---

### Requirement: `startContainer` SHALL accept a `noCache` parameter
`startContainer(projectRoot, removeExisting?, noCache?)` SHALL accept an optional boolean
`noCache` parameter (default `false`) and pass it through to `buildStartArgs`.

#### Scenario: noCache false (default)
- **WHEN** `startContainer` is called without `noCache`
- **THEN** existing callers are unaffected; no `--no-cache` in the spawned command

#### Scenario: noCache true
- **WHEN** `startContainer` is called with `noCache = true`
- **THEN** `devcontainer up` is spawned with `--no-cache` in its argument list

---

### Requirement: `/devcontainer rebuild` SHALL perform a no-cache container start
`/devcontainer rebuild` SHALL stop the current container, regenerate the override config,
clear the startup log, and start a new container with `--remove-existing-container` AND
`--no-cache`.

#### Scenario: Successful rebuild initiation
- **WHEN** `/devcontainer rebuild` is issued
- **THEN** any running container is stopped
- **THEN** `.pi/devcontainer.override.json` is regenerated
- **THEN** the startup log is cleared
- **THEN** `devcontainer up --remove-existing-container --no-cache` is spawned in the background
- **THEN** `ctx.ui.notify` reports `"Devcontainer rebuild started — full image rebuild in progress (this takes longer than a normal start)"`
- **THEN** state is set to `{ enabled: true, starting: true, … }` identical to `/devcontainer on`

#### Scenario: devcontainer CLI not found
- **WHEN** `/devcontainer rebuild` is issued and `devcontainer --version` fails
- **THEN** `ctx.ui.notify` reports `"devcontainer CLI not found. Install it to use container features."` at `"warning"` severity
- **THEN** no container state change occurs

#### Scenario: No devcontainer config found
- **WHEN** `/devcontainer rebuild` is issued and no `.devcontainer/devcontainer.json` or `.devcontainer.json` exists
- **THEN** `ctx.ui.notify` reports the same not-found message as `/devcontainer on`
- **THEN** no container state change occurs

---

### Requirement: `/devcontainer` usage hint SHALL include `rebuild`
The `/devcontainer` command description and the usage hint shown on unknown args SHALL
read: `"Usage: /devcontainer [on | off | rebuild | logs]"`.

#### Scenario: unknown argument shows updated hint
- **WHEN** `/devcontainer unknown-arg` is issued
- **THEN** `ctx.ui.notify` reports `"Usage: /devcontainer [on | off | rebuild | logs]"`
