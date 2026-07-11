
# pi-dev-worktrees

A [pi](https://github.com/earendil-works/pi-coding-agent) extension that provides isolated branch workspaces using [git](https://git-scm.com/) worktrees ([wtp](https://github.com/nicholasgasior/wtp)) and optional [devcontainer](https://github.com/devcontainers/cli) targeting.

## Installation

### pi Extension

```bash
pi install npm:@lanquarden/pi-dev-worktrees
```

Or manually (global):

```bash
cp -r packages/pi-dev-worktrees ~/.pi/agent/extensions/pi-dev-worktrees
cd ~/.pi/agent/extensions/pi-dev-worktrees && npm install
```

Or project-local:

```bash
cp -r packages/pi-dev-worktrees /your/project/.pi/extensions/pi-dev-worktrees
```

### Dashboard Plugin (optional)

Install only when you want [pi-agent-dashboard](https://github.com/lanquarden/pi-agent-dashboard) to show the active worktree and devcontainer state in the session card:

```bash
npm install @lanquarden/pi-dev-worktrees-dashboard-plugin
```

---

## pi Extension

### Requirements

- [`git`](https://git-scm.com/)
- [`wtp`](https://github.com/nicholasgasior/wtp) v2+ (for worktree features)
- [`devcontainer`](https://github.com/devcontainers/cli) CLI (for container features)

### Features

- **`/worktree [set] <branch>`** — create or switch to a `wtp`-managed worktree; `set` prefix is optional
- **`/worktree off`** — deactivate worktree routing (commands run in project root)
- **`/worktree prune`** — clear stale `.git/worktrees/` metadata left by manual deletions
- **`/worktree status`** — snapshot of all active worktrees and container status
- **`/worktree remove <branch>`** — remove a worktree (prompts for confirmation)
- **`/worktree init`** — interactively create `.wtp.yml`
- **`/worktree hooks [show | add <cmd> | remove <n> | clear]`** — manage post-create hooks in `.wtp.yml`
- **`/devcontainer [on | off | stop | rebuild | logs]`** — target the project devcontainer; `rebuild` forces `--no-cache`. `off` disables targeting in this session without stopping the container; `stop` stops the container.
- **LLM tools** (`worktree`, `devcontainer`) — same operations callable by the LLM as tools in a single turn:
  - `worktree` — `action`: `"set"` (branch required) | `"remove"` (branch required) | `"off"` | `"prune"` | `"status"`
  - `devcontainer` — `action`: `"on"` | `"off"` | `"stop"` | `"rebuild"` | `"logs"`

### Configuration

Create `~/.pi/agent/pi-dev-worktrees.config.json`. Worktrees and devcontainers are independent capabilities; both default to enabled and are disabled only by explicit `false`. `repos` is optional.

Minimal configuration when Herdr or another external orchestrator owns worktrees:

```json
{
  "worktrees": { "enabled": false },
  "devcontainer": { "enabled": true }
}
```

All four combinations are supported: managed worktrees with/without devcontainers, external worktrees with/without devcontainers. When a capability is disabled its LLM tool is removed; the slash command remains available only to explain the configuration.

Per-repository managed-worktree configuration:

```json
{
  "worktrees": { "enabled": true },
  "devcontainer": { "enabled": true },
  "repos": [
    {
      "repoGlob": "github.com/myorg/my-repo",
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
- `worktrees.enabled` *(optional, default `true`)* — set `false` when worktrees are externally managed.
- `devcontainer.enabled` *(optional, default `true`)* — gates all container discovery, routing, lifecycle actions, tool exposure, and feedback.
- `repos` *(optional)* — managed-worktree repository mappings.
- `repoGlob` — matched against the `origin` remote URL. `*` matches any sequence including `/`. First match wins.
- `worktreeRoot` — path used as `base_dir` in `.wtp.yml`. Relative paths resolved from project root.
- `postCreateHooks` *(optional)* — extra hooks appended when `ensureWtpYml` generates `.wtp.yml`.

Config is loaded at `session_start`. Use `/reload` or start a new session runtime to apply changes.

### How It Works

#### Worktrees

On `/worktree feature/auth` (or `/worktree set feature/auth`), the extension:
1. Auto-generates `.wtp.yml` at the project root (if absent)
2. Runs `wtp add feature/auth` (or `wtp add -b feature/auth` for new branches)
3. If the worktree already exists, **auto-switches its HEAD** to match the requested branch (recovering from detached HEAD or stale branch)
4. Prefixes all subsequent bash tool calls with `cd <worktree-path> &&`
5. Routes file tools (read/write/edit) with relative paths to the active worktree (absolute paths untouched)

#### External/Herdr Worktree Mode

With `worktrees.enabled: false`, pi's exact session cwd is authoritative. The extension does not read or generate `.wtp.yml`, invoke `wtp`, mutate/prune worktrees, rewrite file paths or bash cwd, inject managed-worktree context, or contribute dashboard worktree management UI. Stale restored worktree state is cleared before routing.

Devcontainers remain independently available, including in non-Git directories. Every container operation—config discovery, override/log paths, labels, probe, start, exec, stop, rebuild, and status—is rooted at the exact cwd where pi started. Restored targeting from another workspace is automatically reconciled at the current cwd without stopping the differently rooted old container.

#### Devcontainer

On `/devcontainer on`, the extension:
1. Generates `.pi/devcontainer.override.json` that mounts the devcontainer workspace at the same absolute path inside the container
2. Probes for an existing running container; if found, **reuses it** instead of restarting (container ID resolved from the startup log or Docker label)
3. If no container responds, spawns `devcontainer up` in the background
4. Wraps all bash tool calls with `devcontainer exec` inside the container

Generated `.wtp.yml`, devcontainer override/log files, and in-repository managed-worktree roots are added idempotently to Git's clone-local exclude file resolved by `git rev-parse --git-path info/exclude`. The extension never modifies `.gitignore`; exclusion is best-effort in non-Git directories.

Use `/devcontainer stop` to stop the container entirely (clears log, persists state, emits events).
Use `/devcontainer off` to just disable targeting in this session *without* stopping the container — other sessions may still be using it.
Use `/devcontainer rebuild` when the `Dockerfile` or base image has changed — it passes `--no-cache` to force a full image rebuild.

#### Composition

When both are active, the worktree `cd` is embedded inside the container exec:
```
devcontainer exec ... -- sh -c 'cd .pi/worktrees/feature/auth && <cmd>'
```

#### HOST: Escape Hatch

Prefix any bash command with `HOST:` to bypass all routing and run directly on the host.

#### `!<cmd>` User Bash Routing

Interactive `!<cmd>` commands follow the same routing as LLM-initiated bash calls:

- **Worktree active, no container:** `!npm test` executes with `cd '<worktree-path>'` prefix
- **Container active:** `!npm test` executes inside the container
- **`!!<cmd>` (double-bang):** NOT intercepted — runs unchanged on host
- **`HOST:<cmd>`:** strips prefix, runs on host

#### git/gh Passthrough

`git`, `gh`, and `find` commands always run on the host regardless of routing state.

### Plain-pi Feedback

The composable footer status shows only active container state: `container:starting` or `container:on`; it is cleared otherwise. In TUI mode, the stock bash tool keeps its built-in execution and result rendering while the call row adds themed, width-aware routing chips: `DEV <id>`, exceptional `HOST`, `RTK`, `RTK fallback`, managed-worktree `CWD`, and `error`. Commands remain left-justified and chips right-justified (or move to a second line when narrow). Presentation metadata is never injected into executable command text. External/Herdr mode never shows a worktree CWD chip.

If another non-built-in extension owns `bash`, it is preserved and a single warning explains that native chips are unavailable; event-based routing and dashboard feedback continue.

### State Persistence

State (active branch, container status) is persisted to the pi session file via `pi.appendEntry()` and restored on session resume. Capability changes sanitize stale restored state before routing.

### Incompatible Extensions

- **`@sherif-fanous/pi-rtk`** — uses a `spawnHook`-based bash tool replacement that fires *after* all `tool_call` handlers, receiving the fully-wrapped `devcontainer exec` string. This breaks container routing silently. Do not load alongside `pi-dev-worktrees`.

---

## Dashboard Plugin

The dashboard plugin is optional. It adds worktree and devcontainer state to the session card in pi-agent-dashboard and enhances the bash tool output with dispatch metadata:

- **Session-card badge** — shows active worktree branch and devcontainer status
- **Enhanced bash renderer** — adds chips showing where each bash command ran:
  - `CWD` — working directory (when routed to a worktree)
  - `RTK` — command rewritten by RTK optimizer
  - `DEV` — executed inside the devcontainer (with container ID)
  - `HOST` — executed on host despite devcontainer being active (git/gh/find, `HOST:` prefix)
  - `error` — container not ready / startup failed

```bash
npm install @lanquarden/pi-dev-worktrees-dashboard-plugin
```

The plugin package lives in `packages/pi-dev-worktrees-dashboard-plugin` and contributes `session-card-badge` and an enhanced `bash` tool renderer.

---

## Optional: pi-rtk-optimizer

[`pi-rtk-optimizer`](https://github.com/MasuRii/pi-rtk-optimizer) is **optional**. It compresses bash output to reduce context consumption. `pi-dev-worktrees` works without it.

### Setup (only needed when both are installed)

`pi-rtk-optimizer` must load *before* `pi-dev-worktrees` so it rewrites commands before the devcontainer wrapping. Use the `settings.json` `extensions` array — not `pi install`:

```json
// .pi/settings.json  (project-level, or ~/.pi/agent/settings.json globally)
{
  "packages": [
    "npm:pi-rtk-optimizer",
    "npm:@lanquarden/pi-dev-worktrees"
  ]
}
```

### RTK in the Container

When devcontainer routing is active, rewritten commands (e.g. `| rtk compress`) run *inside* the container. Add `rtk` via `postCreateCommand` in `devcontainer.json`:

```jsonc
{
  "postCreateCommand": "cp $(which rtk) /usr/local/bin/rtk"
}
```

If `rtk` is *not* installed in the container, `pi-dev-worktrees` automatically falls back to the original LLM command (pre-RTK rewrite) so the container doesn't fail with `rtk: command not found`. Plain pi reports `RTK fallback`; the dashboard event remains backward compatible and includes the new execution-state field additively.

---

## Migration Notes

- `/workspaces` → `/worktree status`
- `/workspace-cleanup` → `/worktree remove <branch>`
