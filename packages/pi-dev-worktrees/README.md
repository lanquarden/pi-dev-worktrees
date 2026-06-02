# @lanquarden/pi-dev-worktrees

A [pi](https://github.com/earendil-works/pi-coding-agent) extension that provides isolated branch workspaces using [git worktrees](https://git-scm.com/docs/git-worktree) (via [wtp](https://github.com/nicholasgasior/wtp)) and optional [devcontainer](https://containers.dev/) targeting.

## Features

- **Worktree isolation** — create/switch/remove git worktrees per branch; all bash commands run inside the active worktree
- **Devcontainer targeting** — start, stop, rebuild, and route bash commands into the project's devcontainer
- **File tool routing** — read/write/edit with relative paths automatically route to the active worktree
- **Composable** — worktree + devcontainer combine: commands run in the container at the worktree path
- **HOST: escape hatch** — prefix any command with `HOST:` to bypass all routing
- **Git/gh passthrough** — git, gh, and find commands always run on the host

## Install

```bash
pi install npm:@lanquarden/pi-dev-worktrees
```

## Requirements

- [`git`](https://git-scm.com/)
- [`wtp`](https://github.com/nicholasgasior/wtp) v2+ (for worktree features)
- [`devcontainer`](https://github.com/devcontainers/cli) CLI (for container features)

## Commands

| Command | Description |
|---------|-------------|
| `/worktree [set] <branch>` | Create or switch to a wtp-managed worktree |
| `/worktree off` | Deactivate worktree routing |
| `/worktree status` | Snapshot of all worktrees and container status |
| `/worktree remove <branch>` | Remove a worktree |
| `/worktree prune` | Clear stale worktree metadata |
| `/worktree init` | Interactively create `.wtp.yml` |
| `/worktree hooks ...` | Manage post-create hooks |
| `/devcontainer on` | Start or reuse the devcontainer |
| `/devcontainer off` | Disable container targeting (leaves container running) |
| `/devcontainer stop` | Stop the container entirely |
| `/devcontainer rebuild` | Rebuild the container image (`--build-no-cache`) |
| `/devcontainer logs` | Tail the startup log |

See the [repo README](https://github.com/lanquarden/pi-dev-worktrees) for full documentation.

## Dashboard Plugin

For pi-agent-dashboard integration, install [`@lanquarden/pi-dev-worktrees-dashboard-plugin`](https://www.npmjs.com/package/@lanquarden/pi-dev-worktrees-dashboard-plugin).
