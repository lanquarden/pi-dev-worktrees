# per-repo-config Specification

## Purpose
TBD - created by archiving change per-repo-config. Update Purpose after archive.
## Requirements
### Requirement: `loadPluginConfig` SHALL read per-repo config from `~/.pi/agent/pi-dev-worktrees.config.json`
`loadPluginConfig()` SHALL return `null` when the config file does not exist. It SHALL
return a `PluginConfig` object when the file exists and contains valid JSON. It SHALL
return `null` and emit a `console.warn` containing the file path and parse error when
the file contains invalid JSON — it SHALL NOT throw.

#### Scenario: file absent
- **WHEN** `~/.pi/agent/pi-dev-worktrees.config.json` does not exist
- **THEN** `loadPluginConfig()` returns `null` and no warning is emitted

#### Scenario: valid config with postCreateHooks
- **GIVEN** the config file contains `{ "repos": [{ "repoGlob": "github.com/org/*", "worktreeRoot": "/ssd/wt", "postCreateHooks": [{ "type": "command", "command": "mise install" }] }] }`
- **WHEN** `loadPluginConfig()` is called
- **THEN** returns the parsed object including the `postCreateHooks` array

#### Scenario: invalid JSON
- **GIVEN** the config file contains invalid JSON
- **WHEN** `loadPluginConfig()` is called
- **THEN** returns `null` and `console.warn` is called with a message containing the file path and parse error

---

### Requirement: `matchRepoGlob` SHALL match remote URLs against glob patterns
`matchRepoGlob(pattern, url)` SHALL return `true` on exact match. It SHALL support `*`
as a wildcard matching any sequence of characters. It SHALL be case-sensitive. Only `*`
is treated as a special character — `?`, `**`, and bracket expressions are literal.

#### Scenario: exact match
- **WHEN** `matchRepoGlob("github.com/org/repo", "github.com/org/repo")` is called
- **THEN** returns `true`

#### Scenario: wildcard org match
- **WHEN** `matchRepoGlob("github.com/org/*", "github.com/org/my-repo")` is called
- **THEN** returns `true`

#### Scenario: no match
- **WHEN** `matchRepoGlob("github.com/a/*", "github.com/b/repo")` is called
- **THEN** returns `false`

#### Scenario: case-sensitive mismatch
- **WHEN** `matchRepoGlob("github.com/Org/*", "github.com/org/repo")` is called
- **THEN** returns `false`

---

### Requirement: `resolveWorktreeRoot` SHALL return the first matching worktreeRoot or the default
`resolveWorktreeRoot(remoteUrl, config)` SHALL iterate `config.repos` in array order and
return the `worktreeRoot` of the first entry whose `repoGlob` matches `remoteUrl`. It
SHALL return `".pi/worktrees"` when no entry matches or when `config` is `null`.

#### Scenario: first match wins
- **GIVEN** `config.repos` has a specific entry before a wildcard entry
- **WHEN** `remoteUrl` matches the specific entry
- **THEN** returns the specific entry's `worktreeRoot`

#### Scenario: fallback to default
- **GIVEN** no entry in `config.repos` matches `remoteUrl`
- **THEN** returns `".pi/worktrees"`

#### Scenario: null config returns default
- **WHEN** `config` is `null`
- **THEN** returns `".pi/worktrees"`

---

### Requirement: `resolvePostCreateHooks` SHALL return hooks from the first matching entry or `[]`
`resolvePostCreateHooks(remoteUrl, config)` SHALL return the `postCreateHooks` array of
the first matching entry. It SHALL return `[]` when no entry matches, when the matching
entry has no `postCreateHooks`, or when `config` is `null`.

#### Scenario: matching entry with hooks
- **GIVEN** a matching entry with `postCreateHooks: [{ type: "command", command: "mise install" }]`
- **WHEN** `resolvePostCreateHooks` is called with the matching `remoteUrl`
- **THEN** returns `[{ type: "command", command: "mise install" }]`

#### Scenario: matching entry without hooks
- **GIVEN** a matching entry with no `postCreateHooks` field
- **THEN** returns `[]`

#### Scenario: no match or null config
- **WHEN** no entry matches or `config` is `null`
- **THEN** returns `[]`

---

### Requirement: `createOrTargetWorktree` SHALL accept a `worktreeRoot` parameter
`createOrTargetWorktree` SHALL use a `worktreeRoot` parameter to construct the worktree
path. Relative paths SHALL be resolved against `projectRoot`; absolute paths SHALL be
used as-is.

#### Scenario: relative root (default preserved)
- **GIVEN** `projectRoot = "/home/user/repos/myrepo"` and `worktreeRoot = ".pi/worktrees"`
- **WHEN** creating worktree for branch `feature/x`
- **THEN** worktree is created at `/home/user/repos/myrepo/.pi/worktrees/feature/x`

#### Scenario: absolute root from config
- **GIVEN** `worktreeRoot = "/fast-ssd/worktrees"`
- **WHEN** creating worktree for branch `feature/x`
- **THEN** worktree is created at `/fast-ssd/worktrees/feature/x`

---

### Requirement: `ensureWtpYml` SHALL inject `worktreeRoot` as `base_dir` and append `postCreateHooks`
`ensureWtpYml` SHALL accept `worktreeRoot` and `postCreateHooks` parameters. The
`worktreeRoot` SHALL be written as the `base_dir` value in the generated `.wtp.yml`.
When `postCreateHooks` is non-empty, each hook SHALL be appended after the two default
hooks. When `.wtp.yml` already exists, `ensureWtpYml` SHALL NOT overwrite it.

#### Scenario: default root, no extra hooks
- **GIVEN** `worktreeRoot = ".pi/worktrees"` and `postCreateHooks = []`
- **THEN** generated `.wtp.yml` contains `base_dir: .pi/worktrees` and exactly the two default hooks

#### Scenario: custom root with extra hooks appended
- **GIVEN** `worktreeRoot = "/fast-ssd/worktrees"` and `postCreateHooks = [{ type: "command", command: "mise install" }]`
- **THEN** generated `.wtp.yml` contains `base_dir: /fast-ssd/worktrees` and the two default hooks followed by the `mise install` hook

---

### Requirement: `/workspace-cleanup` SHALL enumerate from `resolvedWorktreeRoot`
`/workspace-cleanup` SHALL enumerate worktree directories from the resolved
`worktreeRoot` (from config or default `".pi/worktrees"`) rather than a hardcoded path.

#### Scenario: custom root enumerated
- **GIVEN** `resolvedWorktreeRoot = "/fast-ssd/worktrees"`
- **WHEN** `/workspace-cleanup` is invoked
- **THEN** worktree entries are listed from `/fast-ssd/worktrees` and not from `.pi/worktrees`

