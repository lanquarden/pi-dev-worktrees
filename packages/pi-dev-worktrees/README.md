# @lanquarden/pi-dev-worktrees

A [pi](https://github.com/earendil-works/pi-coding-agent) extension that provides isolated branch workspaces using [git worktrees](https://git-scm.com/docs/git-worktree) (via [wtp](https://github.com/nicholasgasior/wtp)) and optional [devcontainer](https://containers.dev/) targeting.

## Features

- **Worktree isolation** — create/switch/remove git worktrees per branch; all bash commands run inside the active worktree
- **Devcontainer targeting** — start, stop, rebuild, and route bash commands into the project's devcontainer
- **File tool routing** — read/write/edit with relative paths automatically route to the active worktree
- **Composable** — worktree + devcontainer combine: commands run in the container at the worktree path
- **HOST: escape hatch** — prefix any command with `HOST:` to bypass all routing
- **Git/gh passthrough** — git, gh, and find commands always run on the host
- **External/Herdr mode** — disable extension-owned worktrees while keeping cwd-rooted devcontainers
- **Native TUI feedback** — `DEV`, `HOST`, `RTK`, `RTK fallback`, managed `CWD`, and `error` chips without changing executable commands
- **Local generated-artifact excludes** — uses Git's resolved `info/exclude`; never modifies `.gitignore`

## Install

```bash
pi install npm:@lanquarden/pi-dev-worktrees
```

## Requirements

- [`git`](https://git-scm.com/)
- [`wtp`](https://github.com/nicholasgasior/wtp) v2+ (for worktree features)
- [`devcontainer`](https://github.com/devcontainers/cli) CLI (for container features)

## Configuration

`~/.pi/agent/pi-dev-worktrees.config.json` supports independent default-on capability flags; `repos` is optional:

```json
{
  "worktrees": { "enabled": false },
  "devcontainer": { "enabled": true },
  "advisories": { "rtkLoadOrder": "once" }
}
```

With worktrees disabled, pi's exact session cwd is authoritative. No `.wtp.yml`, `wtp` invocation, worktree/file-path routing, managed-worktree dashboard UI, or worktree tool remains active. Devcontainer discovery, override/log generation, probes, labels, lifecycle calls, and exec routing all use that exact cwd, including non-Git directories. Config changes require `/reload` or a new session runtime.

Set `devcontainer.enabled` to `false` to disable all container side effects, routing, tool exposure, and feedback independently of worktrees.

`advisories.rtkLoadOrder` controls the pi-rtk-optimizer load-order startup info message: `"once"` (default) shows it only once per machine, `"always"` shows it every session, `"off"` suppresses it entirely. Once shown, the marker persists at `~/.pi/agent/pi-dev-worktrees.advisory-state.json`; delete that file to see the advisory again. Conflict warnings (e.g. an incompatible spawnHook-based pi-rtk) are always emitted regardless of this setting.

Generated artifacts are excluded through `git rev-parse --git-path info/exclude`, including linked worktrees and external Git directories. `.gitignore` is preserved byte-for-byte.

Plain-pi status shows only `container:starting` or `container:on`. TUI bash rows preserve stock execution/results and add width-aware routing chips; external mode omits `CWD`.

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

When a capability is disabled, its LLM tool is removed. The corresponding slash command remains registered but is explanatory and non-mutating.

See the [repo README](https://github.com/lanquarden/pi-dev-worktrees) for full documentation.

## Dashboard Plugin

For pi-agent-dashboard integration, install [`@lanquarden/pi-dev-worktrees-dashboard-plugin`](https://www.npmjs.com/package/@lanquarden/pi-dev-worktrees-dashboard-plugin).
