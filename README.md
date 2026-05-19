# pi-dev-worktrees

A [pi](https://github.com/earendil-works/pi-coding-agent) extension that provides isolated branch workspaces using git worktrees (`wtp`) and optional devcontainer targeting.

## Features

- **`/worktree [branch | off | prune]`** — create or switch to a `wtp`-managed worktree (location configured via `~/.pi/agent/pi-dev-worktrees.config.json` or defaults to `.pi/worktrees/`); all bash commands run inside it; `prune` clears stale `.git/worktrees/` metadata
- **`/devcontainer [on | off | rebuild | logs]`** — target the project devcontainer; bash commands execute inside the container; `rebuild` forces a full image rebuild with `--no-cache`
- **`/workspaces`** — snapshot of all active worktrees and container status
- **`/workspace-cleanup`** — interactive removal of stale worktrees; runs `git worktree prune` after removals to clear any lingering metadata
- **Tools** (`worktree_set`, `devcontainer_control`, `workspaces_status`, `workspace_remove`) — same operations callable by the LLM or pi-dashboard

## Requirements

- `git`
- [`wtp`](https://github.com/nicholasgasior/wtp) v2+ (for worktree features)
- `devcontainer` CLI (for container features)

## Companion extensions

[`pi-rtk-optimizer`](https://github.com/MasuRii/pi-rtk-optimizer) is the recommended companion extension for token compression. It rewrites bash commands to pipe output through `rtk compress`, significantly reducing context consumption.

### Why `pi install` is wrong

`pi install npm:pi-rtk-optimizer` places the extension at **rank 4** (packages), which loads *after* all project-local and global extensions — including `pi-dev-worktrees`. This puts it in the wrong position: `pi-rtk-optimizer` must mutate `event.input.command` *before* `pi-dev-worktrees` wraps it in `devcontainer exec`.

### Correct setup — `settings.json` `extensions` array

Both extensions must appear in the **same** `settings.json` `extensions` array with `pi-rtk-optimizer` listed first. Array position within a rank is fully deterministic:

```json
// .pi/settings.json  (project-level)
{
  "extensions": [
    "/path/to/pi-rtk-optimizer",
    "/path/to/pi-dev-worktrees"
  ]
}
```

Or for global configuration:

```json
// ~/.pi/agent/settings.json
{
  "extensions": [
    "/path/to/pi-rtk-optimizer",
    "/path/to/pi-dev-worktrees"
  ]
}
```

With this order, `tool_call` handlers fire as: `pi-rtk-optimizer` rewrites the raw command → `pi-dev-worktrees` wraps the rewritten command in `devcontainer exec`. Correct composition.

### RTK-in-container

When `pi-rtk-optimizer` rewrites a command to include `| rtk compress`, that pipe runs *inside* the container when devcontainer routing is active. `rtk` must be available in the container.

Add `rtk` via `postCreateCommand` or `postCreateHooks` in `devcontainer.json`:

```jsonc
// .devcontainer/devcontainer.json
{
  "postCreateCommand": "cp $(which rtk) /usr/local/bin/rtk"
}
```

Or, if the container does not have the host `rtk` on its path at build time, install it during setup:

```jsonc
{
  "postCreateCommand": "curl -fsSL https://raw.githubusercontent.com/MasuRii/rtk/main/install.sh | sh"
}
```

`pi-dev-worktrees` probes for `rtk` in the container at container-ready time and emits a one-time advisory if it is absent.

## Incompatible extensions

- **`@sherif-fanous/pi-rtk`** — uses a `spawnHook`-based bash tool replacement. `spawnHook` fires *after* all `tool_call` handlers, so it receives the fully-wrapped `devcontainer exec ... -- sh -c '...'` string instead of the inner command. This breaks container routing silently. Do not load alongside `pi-dev-worktrees`.
- **`mcowger/pi-rtk`** — stale (no active maintenance), superseded by `pi-rtk-optimizer`. Uses only `tool_result` (no conflict), but not recommended for new setups.

## Installation

Copy to (or symlink from) your global pi extensions directory:

```bash
cp -r . ~/.pi/agent/extensions/pi-dev-worktrees
cd ~/.pi/agent/extensions/pi-dev-worktrees
npm install
```

Or for project-local use:

```bash
cp -r . /your/project/.pi/extensions/pi-dev-worktrees
```

## How it works

### Worktrees

On `/worktree feature/auth`, the extension:
1. Auto-generates `.wtp.yml` at the project root (if absent) with `base_dir` set to the resolved `worktreeRoot` (see **Per-repo config** below)
2. Runs `wtp add feature/auth` (or `wtp add -b feature/auth` for new branches)
3. All subsequent bash tool calls are prefixed with `cd <worktree-path> &&`

Run `/worktree prune` to remove stale `.git/worktrees/` metadata entries left behind by manual worktree directory deletions (equivalent to running `git worktree prune` in the project root). `/workspace-cleanup` also runs `git worktree prune` automatically after its removal loop, so ghost entries are cleaned up even if worktrees were deleted outside of git.

### Per-repo config

Create `~/.pi/agent/pi-dev-worktrees.config.json` to configure `base_dir` and post-create hooks per repository. The file is optional — if absent, the default `base_dir` of `.pi/worktrees` is used.

```json
{
  "repos": [
    {
      "repoGlob": "github.com/myorg/*",
      "worktreeRoot": "/fast-ssd/worktrees",
      "postCreateHooks": [
        { "type": "command", "command": "mise install" },
        { "type": "copy", "from": ".env.local", "to": ".env.local" }
      ]
    },
    { "repoGlob": "*", "worktreeRoot": ".pi/worktrees" }
  ]
}
```

**Schema:**
- `repoGlob` — matched against the `origin` remote URL (`git remote get-url origin`). `*` is the only wildcard; it matches any sequence of characters including `/`. Matching is case-sensitive.
- `worktreeRoot` — path used as `base_dir` in `.wtp.yml`. Relative paths are resolved from the project root; absolute paths are used as-is.
- `postCreateHooks` *(optional)* — extra hooks appended after the two default hooks (copy-secrets + direnv allow) when `ensureWtpYml` generates a new `.wtp.yml`. Each entry is a `WtpHook` (`type: command | copy | symlink`). Has no effect if `.wtp.yml` already exists.

Entries are evaluated in order; the **first match wins**. If no entry matches, `base_dir` defaults to `.pi/worktrees` and no extra hooks are added.

Config is loaded once at `session_start`. Edit the file and restart the pi session to apply changes.

### Devcontainer

On `/devcontainer on`, the extension:
1. Generates `.pi/devcontainer.override.json` that mounts the project at the same absolute path inside the container
2. Probes the container with `devcontainer exec ... -- echo ok`; if not running, spawns `devcontainer up` in the background
3. All bash tool calls are wrapped with `devcontainer exec --workspace-folder <root> --override-config .pi/devcontainer.override.json -- sh -c '...'`

Use `/devcontainer rebuild` instead of `/devcontainer on` when the `Dockerfile` or base image has changed. It runs the same lifecycle (stop → regenerate override → start) but passes `--no-cache` to `devcontainer up`, forcing Docker to rebuild all image layers from scratch. Rebuilds take longer than a normal start.

### Composition

When both are active, the worktree `cd` is embedded inside the container exec:
```
devcontainer exec ... -- sh -c 'cd .pi/worktrees/feature/auth && <cmd>'
```

### HOST: escape hatch

Prefix any bash command with `HOST:` to bypass all routing and run directly on the host.

### `!<cmd>` user bash routing

`pi-dev-worktrees` hooks the `user_bash` event so interactive `!<cmd>` commands follow the same routing decision table as LLM-initiated bash calls:

- **Worktree active, no container:** `!npm test` executes as `cd '<worktree-path>' || ...; npm test`
- **Container active:** `!npm test` executes as `devcontainer exec ... -- sh -c 'cd <workspace> && npm test'`
- **`!!<cmd>` (double-bang):** NOT intercepted — pi handles it normally without worktree or container routing (same policy as `pi-rtk-optimizer`)
- **`HOST:<cmd>`:** strips the prefix and runs on the host, bypassing all routing
- **No worktree, no container:** command runs unchanged on the host

### git/gh/hub/find passthrough

`git`, `gh`, `hub`, and `find` commands always run on the host regardless of worktree/container state.

## Dashboard compatibility

The `/worktree` and `/devcontainer` slash commands require the pi TUI.  
From the pi-dashboard, use the registered tools (`worktree_set`, `devcontainer_control`, etc.) instead.

## State persistence

State (active branch, container status) is persisted to the pi session file via `pi.appendEntry()` and restored on session resume.
