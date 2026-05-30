# @lanquarden/pi-dev-worktrees-dashboard-plugin

A [pi-agent-dashboard](https://github.com/lanquarden/pi-agent-dashboard) plugin that shows active worktree and devcontainer state from [`@lanquarden/pi-dev-worktrees`](https://www.npmjs.com/package/@lanquarden/pi-dev-worktrees).

## Features

- **Session-card badge** — displays the active worktree branch and devcontainer status on each session card
- **Enhanced bash renderer** — adds dispatch chips to bash tool output:
  - `CWD` — working directory (when routed to a worktree)
  - `RTK` — command rewritten by RTK optimizer
  - `DEV` — executed inside the devcontainer (with container ID)
  - `HOST` — executed on host despite active devcontainer (git/gh/find, `HOST:` prefix)
  - `error` — container not ready or startup failed
- **Workspaces modal** — overview of all worktrees and devcontainer state

## Install

```bash
npm install @lanquarden/pi-dev-worktrees-dashboard-plugin
```

This goes in your pi-agent-dashboard project alongside other dashboard plugins.

## Requirements

- `@lanquarden/pi-dev-worktrees` installed as a pi extension
- pi-agent-dashboard with plugin support

See the [repo README](https://github.com/lanquarden/pi-dev-worktrees) for full documentation.
