# pi-dev-worktrees

A [pi](https://github.com/earendil-works/pi-coding-agent) extension that provides isolated branch workspaces using git worktrees (`wtp`) and optional devcontainer targeting.

## Features

- **`/worktree [branch | off]`** — create or switch to a `wtp`-managed worktree under `.pi/worktrees/`; all bash commands run inside it
- **`/devcontainer [on | off | rebuild | logs]`** — target the project devcontainer; bash commands execute inside the container; `rebuild` forces a full image rebuild with `--no-cache`
- **`/workspaces`** — snapshot of all active worktrees and container status
- **`/workspace-cleanup`** — interactive removal of stale worktrees
- **Tools** (`worktree_set`, `devcontainer_control`, `workspaces_status`, `workspace_remove`) — same operations callable by the LLM or pi-dashboard

## Requirements

- `git`
- [`wtp`](https://github.com/nicholasgasior/wtp) v2+ (for worktree features)
- `devcontainer` CLI (for container features)

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
1. Auto-generates `.wtp.yml` at the project root (if absent) with `base_dir: .pi/worktrees`
2. Runs `wtp add feature/auth` (or `wtp add -b feature/auth` for new branches)
3. All subsequent bash tool calls are prefixed with `cd .pi/worktrees/feature/auth &&`

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

### git/gh/hub/find passthrough

`git`, `gh`, `hub`, and `find` commands always run on the host regardless of worktree/container state.

## Dashboard compatibility

The `/worktree` and `/devcontainer` slash commands require the pi TUI.  
From the pi-dashboard, use the registered tools (`worktree_set`, `devcontainer_control`, etc.) instead.

## State persistence

State (active branch, container status) is persisted to the pi session file via `pi.appendEntry()` and restored on session resume.
