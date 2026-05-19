# Spec: `pi-dev-worktrees` — Pi Extension

**Status:** Draft  
**Date:** 2026-05-12  
**Location:** `.pi/extensions/pi-dev-worktrees/` (project-local extension)

---

## 1. Overview

`pi-dev-worktrees` is a pi extension that provides isolated branch workspaces for pi sessions using:

- **wtp** for git worktrees — lightweight per-branch directory isolation inside the project tree
- **devcontainer CLI** for container isolation — single container per project (not per branch)

**Key differences from `opencode-devcontainers`:**

| Feature | opencode-devcontainers | pi-dev-worktrees |
|---------|----------------------|--------------|
| Worktree location | `~/.local/share/opencode/worktree/<repo>/<branch>/` | `<project>/.pi/worktrees/<branch>/` |
| Worktree tooling | raw `git worktree add` | `wtp` (with `.wtp.yml` hooks) |
| Devcontainer scope | one container per branch-clone | **one container per project** |
| Config management | manual / env vars | auto-generates `.wtp.yml` if absent |
| Dashboard integration | none | structured `pi.events` for bridge |
| Packaging | npm package | local `.pi/extensions/` |

---

## 2. Prerequisites

- `git` (always required)
- `wtp` v2+ — for worktree management (`wtp --version`)
- `devcontainer` CLI — only for container features (`devcontainer --version`)
- Project must be a git repository main worktree (not already a worktree itself)

---

## 3. File Layout

```
<project>/
├── .pi/
│   ├── extensions/
│   │   └── pi-dev-worktrees/
│   │       ├── index.ts            ← extension entry point (registers all hooks/commands)
│   │       ├── package.json        ← npm deps declaration
│   │       ├── worktrees.ts        ← wtp invocation, wtp.yml generation
│   │       ├── devcontainer.ts     ← devcontainer up/exec/status
│   │       ├── session.ts          ← per-session state: save/load via pi.appendEntry()
│   │       ├── bash-intercept.ts   ← tool_call "bash" routing logic
│   │       └── dashboard-events.ts ← pi.events emit helpers
│   ├── worktrees/                  ← wtp base_dir (created on first use)
│   │   ├── feature/                ← wtp preserves slashes as subdirs
│   │   │   └── auth/               ← worktree for branch feature/auth
│   │   └── fix-logging/
│   └── devcontainer.override.json  ← generated override (transparent workspace mount)
└── .wtp.yml                        ← auto-generated if absent
```

`.pi/worktrees/` and `.pi/devcontainer.override.json` are auto-appended to `.gitignore` on first use of each feature.

---

## 4. `.wtp.yml` Auto-Generation

On `session_start` (reason `"startup"` or `"new"`), if `.wtp.yml` does not exist at the project root and the CWD is a git repository, the extension writes:

```yaml
version: "1.0"
defaults:
  base_dir: ".pi/worktrees"

hooks:
  post_create:
    # Copy gitignored secrets from the main repo into the new worktree
    - type: command
      command: |
        MAIN=$(git worktree list --porcelain | head -1 | awk '{print $2}')
        for f in $(git -C "$MAIN" ls-files --others --ignored --exclude-standard 2>/dev/null | grep -v '/'); do
          [ -f "$MAIN/$f" ] && cp "$MAIN/$f" . && echo "Copied $f"
        done

    # Allow direnv if .envrc is present
    - type: command
      command: "[ -f .envrc ] && direnv allow || true"
```

The extension notifies the user: `"Generated .wtp.yml (base_dir: .pi/worktrees)"`.  
If `.wtp.yml` already exists it is left completely untouched.

---

## 5. Session State

State is persisted to the session file (survives restarts and `/resume`) via `pi.appendEntry()`.

```typescript
// customType: "pi-dev-worktrees:state"
interface WorktreesState {
  worktree?: {
    branch: string;  // original branch name, e.g. "feature/auth"
    path:   string;  // absolute path, e.g. "/repo/.pi/worktrees/feature/auth"
  };
  devcontainer?: {
    enabled:   boolean;
    workspace: string;   // absolute project root
    starting?: boolean;  // true while `devcontainer up` is in flight
    startedAt?: number;  // Unix ms timestamp when startup was initiated
  };
}
```

**Restore on session_start:** scan `ctx.sessionManager.getEntries()` for all entries with `customType === "pi-dev-worktrees:state"`, take the last one, and re-hydrate the in-memory state.

---

## 6. Commands

### `/worktree [branch | off]`

| Invocation | Effect |
|------------|--------|
| `/worktree` | Show current worktree status |
| `/worktree feature/auth` | Create (if needed) and target worktree |
| `/worktree off` | Disable worktree targeting |

**Branch names with slashes:** wtp preserves slashes as path separators. `feature/auth` → `.pi/worktrees/feature/auth/`. No sanitization is applied — the original branch name is passed directly to `wtp add`.

**Create/target flow:**
1. `git rev-parse --show-toplevel` → project root
2. Guard: if CWD is itself a worktree → error "Run from the main worktree"
3. Ensure `.wtp.yml` exists (auto-generate if not)
4. Check if `.pi/worktrees/<branch>/` already exists (branch name as-is)
   - Exists → reuse path (skip `wtp add`)
   - Missing → determine wtp variant:
     - `git branch --list <branch>` non-empty **or** `git ls-remote --heads origin <branch>` non-empty → `wtp add <branch>`
     - Both empty (new branch) → `wtp add -b <branch>`
5. Auto-append `.pi/worktrees/` to `.gitignore` if pattern not already present
6. Save state via `pi.appendEntry("pi-dev-worktrees:state", state)`
7. Emit `pi.events`:
   - First creation → `pi-dev-worktrees:workspace-created`
   - Re-targeting → `pi-dev-worktrees:workspace-switched`
8. Notify: `"Worktree active: .pi/worktrees/feature/auth/ — bash runs there"`

**Disable (`/worktree off`):**
1. Clear `state.worktree`, save
2. Emit `pi-dev-worktrees:workspace-switched { worktree: null, cwd }`
3. Notify: `"Worktree mode off — commands run in project root"`

---

### `/devcontainer [on | off]`

| Invocation | Effect |
|------------|--------|
| `/devcontainer` | Show container status |
| `/devcontainer on` | Start (or reuse) the project devcontainer |
| `/devcontainer off` | Stop targeting container (container keeps running) |

**One container per project.** The container is always started at the **project root**, not at a worktree path. All sessions (worktree-targeted or not) share the same container.

**`/devcontainer on` flow:**
1. Check CLI available: `devcontainer --version`
2. Find `.devcontainer/devcontainer.json` or `.devcontainer.json` at project root — error if absent
3. Generate `.pi/devcontainer.override.json` if absent — see §6a
4. Probe liveness: `devcontainer exec --workspace-folder <root> --override-config .pi/devcontainer.override.json -- echo ok` (2 s timeout)
   - Success → container already running → save state `{ enabled: true }`, notify, done
5. Spawn `devcontainer up --workspace-folder <root> --override-config .pi/devcontainer.override.json` detached (background)
6. Save state `{ enabled: true, starting: true }`
7. Emit `pi-dev-worktrees:devcontainer-starting { workspace, cwd }`
8. Notify: `"Container starting… bash commands will queue until it's ready"`

**Readiness polling (lazy, in bash intercept):** on every intercepted bash command while `starting: true`:
1. Parse `.pi/devcontainer-up.log` for the terminal JSON outcome line (`{"outcome":"success"|"error",...}`):
   - `outcome: "error"` → mark container disabled, notify user, let command run on host
   - `outcome: "success"` → **trust the log immediately** — mark container ready without an exec probe (exec can be slow on first invocation and would block the agent unnecessarily)
   - `outcome: null` (still running) → run exec probe (10s timeout) as fallback
2. Until marked ready: replace the bash command with an error that includes: elapsed time, startup outcome context, and last 30 lines of `.pi/devcontainer-up.log`
3. After 5 minutes with no outcome: show "stuck" warning with restart suggestion

Container startup log is captured to `.pi/devcontainer-up.log` (truncated on each new start attempt).
Exec probe timeout is 10 seconds (increased from 2s to handle slow first-exec after container start).

**`/devcontainer off` flow:**
1. Read `containerId` from `.pi/devcontainer-up.log` and run `docker stop <containerId>` (30s timeout, best-effort)
2. Clear `.pi/devcontainer-up.log` (truncate to empty) so stale `outcome:success` cannot short-circuit the next `/devcontainer on`
3. Clear `state.devcontainer.remoteWorkspaceFolder`
4. Set `state.devcontainer.enabled = false`, save
5. Emit `pi-dev-worktrees:devcontainer-stopped`
6. Notify with stop result: container ID stopped, or warning if stop failed

---

### §6a — `.pi/devcontainer.override.json`

Generated on first `/devcontainer on` call (or regenerated if the existing file is the old
2-field stub from a previous version of pi-dev-worktrees).

Because `--override-config` **replaces** the entire devcontainer config rather than merging
on top of it, the override must be a complete, valid devcontainer config. The extension
generates it by:

1. Reading the base `devcontainer.json` from the project (stripping `//` and `/* */` comments
   which devcontainer files commonly include).
2. Overlaying the workspace-mount fields:

```json
{
  "workspaceMount": "source=${localWorkspaceFolder},target=${localWorkspaceFolder},type=bind",
  "workspaceFolder": "${localWorkspaceFolder}"
}
```

3. Writing the merged result as `.pi/devcontainer.override.json`.

**Effect:** All base config fields (`image`, `dockerFile`, `containerUser`, `runArgs`, etc.) are
preserved. The workspace-mount fields ensure paths inside the container match the host exactly
(transparent mount). The `devcontainer` CLI validates the override as a standalone config, so
the container source field (`image`/`dockerFile`/`dockerComposeFile`) must be present.

**Regeneration of old stubs:** If the file already exists and contains only `workspaceMount`
and `workspaceFolder` (the old 2-field stub written by a previous version of this extension),
it is deleted and regenerated. Otherwise the file is left untouched — the user may have
customised it.

The file is added to `.gitignore` alongside `.pi/worktrees/` on first generation.

---

### `/workspaces`

Prints a snapshot of all worktrees and container status for the current project.

```
Worktrees (.pi/worktrees/):
  ● feature/auth     .pi/worktrees/feature/auth/   [this session]
  ○ fix-logging      .pi/worktrees/fix-logging/

Devcontainer:
  ● Running at project root
  Use HOST: prefix to bypass container

Current session: worktree=feature/auth  devcontainer=on
```

**Implementation:**
- `wtp list --quiet` → filter entries whose path starts with `<root>/.pi/worktrees/`
- Container status: probe `devcontainer exec ... --override-config .pi/devcontainer.override.json -- echo ok` with 2 s timeout
- Mark the worktree matching `state.worktree.path` as `[this session]`

---

### `/workspace-cleanup`

Interactive removal of stale worktrees.

1. Enumerate all directories under `.pi/worktrees/`
2. For each:
   - `stat` the directory → last modified time
   - `git -C <path> status --porcelain` → dirty flag
3. Label as **stale** if mtime > 7 days ago
4. Present `ctx.ui.multiselect("Remove stale worktrees?", candidates)` — each entry shows branch, age, dirty flag
5. For each selected:
   - If dirty → `ctx.ui.confirm("Has uncommitted changes. Force remove?")` → skip if declined
   - `wtp remove [--force] <branch>` (original branch name, e.g. `feature/auth`)
   - Emit `pi-dev-worktrees:workspace-removed { branch, path, cwd }`
6. Notify summary: `"Removed N worktree(s)"`

---

## 7. Bash Tool Interception

Registered via `pi.on("tool_call", ...)`, only fires for `event.toolName === "bash"`. Mutates `event.input.command` in place.

**Decision table (evaluated top to bottom, first match wins):**

| # | Condition | Action |
|---|-----------|--------|
| 1 | `cmd.match(/^HOST:/i)` | Strip `HOST:` prefix; pass through unchanged (host, original cwd) |
| 2 | `cmd.match(/^(git|gh|hub|find)(\s|$)/)` | Pass through unchanged (run on host) |
| 3 | `devcontainer.enabled && devcontainer.starting` | Replace cmd with error: elapsed time + log tail + restart hints (`exit 1`) |
| 4 | `devcontainer.enabled && !devcontainer.starting` | Re-probe liveness; if ready wrap with `devcontainer exec …`; if probe fails → same error as rule 3 |
| 5 | `worktree.path` set | Prepend `cd <worktree-path> && ` |
| 6 | — | Pass through unchanged |

**Composition (rules 4 + 5):** When both devcontainer and worktree are active, the worktree `cd` is embedded inside the container exec:

```
devcontainer exec --workspace-folder <root> --override-config .pi/devcontainer.override.json -- sh -c 'cd <worktree-path> && <cmd>'
```

Because the generated override sets `workspaceMount` and `workspaceFolder` to `${localWorkspaceFolder}`, the container mounts the repo at the **same absolute path as the host**. Container paths and host paths are identical — no mapping logic needed. `HOST:` remains the escape hatch for anything that must bypass the container entirely.

**Shell quoting:** All interpolated paths use a `shellQuote(s)` helper:

```typescript
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
```

---

## 8. `before_agent_start` Context Injection

Injects a brief system-prompt addendum so the LLM is aware of the active workspace context:

```typescript
pi.on("before_agent_start", async (_event, ctx) => {
  const state = loadState(ctx);
  if (!state.worktree && !state.devcontainer?.enabled) return;

  const lines = ["## Active Workspace (pi-dev-worktrees)"];
  if (state.worktree) {
    lines.push(`- Branch: \`${state.worktree.branch}\``);
    lines.push(`- Worktree path: \`${state.worktree.path}\``);
    lines.push("- Bash commands run inside this worktree directory");
  }
  if (state.devcontainer?.enabled) {
    const status = state.devcontainer.starting ? "starting…" : "running";
    lines.push(`- Devcontainer: ${status} (project root)`);
    lines.push("- Bash commands execute inside the container");
    lines.push("- Prefix a command with `HOST:` to run it on the host instead");
  }

  return {
    message: {
      customType: "pi-dev-worktrees:context",
      content: lines.join("\n"),
      display: false,   // injected silently, not shown in chat
    },
  };
});
```

---

## 9. Dashboard Integration (`pi.events`)

The extension emits structured events on `pi.events`. The pi-dashboard bridge intercepts **all** `pi.events.emit` calls via a catch-all shim and forwards them as `event_forward` protocol messages, using the channel name directly as `eventType` for unknown channels. `pi-dev-worktrees:*` events are therefore forwarded automatically — no bridge changes are needed.

### Event Catalogue

| Event | Payload | When |
|-------|---------|------|
| `pi-dev-worktrees:workspace-created` | `{ type: "worktree", branch, path, cwd }` | wtp creates a new worktree |
| `pi-dev-worktrees:workspace-switched` | `{ type: "worktree", branch, path, cwd }` or `{ worktree: null, cwd }` | session retargets or disables |
| `pi-dev-worktrees:workspace-removed` | `{ type: "worktree", branch, path, cwd }` | worktree deleted by cleanup |
| `pi-dev-worktrees:devcontainer-starting` | `{ workspace, cwd }` | `devcontainer up` launched |
| `pi-dev-worktrees:devcontainer-ready` | `{ workspace, cwd }` | container confirmed running |
| `pi-dev-worktrees:devcontainer-stopped` | `{ workspace, cwd }` | targeting disabled |
| `pi-dev-worktrees:state` | `WorktreesState` | any state mutation (full snapshot) |

`cwd` = absolute project root, allowing the dashboard to correlate with its pinned directory list.

### Phase 2 — Dashboard UI (future, out of scope for v1)

When a `ui:list-modules` probe adapter is added later, this would surface:
- A `management-modal` slash-command (`/workspaces`) showing a table of all worktrees with their status, age, and a remove button
- A `footer-segment` decorator showing the active branch / container state per session card

The v1 event payload schema is deliberately compatible with this.

---

## 10. `package.json`

```json
{
  "name": "pi-dev-worktrees",
  "private": true,
  "type": "module",
  "dependencies": {
    "js-yaml": "^4.1.0"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "typebox": "*"
  }
}
```

`js-yaml` is used only for `.wtp.yml` generation (stringify). All other logic uses Node.js built-ins.

---

## 11. Design Decisions (resolved)

1. **`wtp` not in PATH** — Show a `ctx.ui.notify(..., "warning")` on every `/worktree` command attempt. `/devcontainer` and `/workspaces` remain usable without `wtp`.

2. **`.pi/worktrees/` in `.gitignore`** — Auto-appended to the project root `.gitignore` on first worktree creation, if the pattern is not already present. Scope is `.pi/worktrees/` specifically (not all of `.pi/`).

3. **Container path when worktree is active** — The extension generates `.pi/devcontainer.override.json` setting `workspaceMount` and `workspaceFolder` to `${localWorkspaceFolder}`. This makes container paths identical to host paths — `.pi/worktrees/<branch>/` is accessible at the same absolute path inside the container. The user's `devcontainer.json` is never modified. `HOST:` remains the escape hatch for anything that must run outside the container entirely.

4. **pi opened in a subdirectory** — `git rev-parse --show-toplevel` returns the repo root regardless of CWD. `.wtp.yml` is written to the repo root and `base_dir` resolves from there. No special handling needed — this is consistent with wtp's own behavior.

5. **Branch names with slashes (verified by live testing)** — wtp preserves slashes as subdirectory separators. `wtp add feature/auth` creates `.pi/worktrees/feature/auth/`. `wtp remove feature/auth` works correctly with the original branch name. No sanitization needed or applied.

6. **Branch existence check before `wtp add`** — The extension explicitly checks: `git branch --list <branch>` (local) and `git ls-remote --heads origin <branch>` (remote). If either is non-empty, use `wtp add <branch>`; if both are empty, use `wtp add -b <branch>`. This avoids relying on wtp error-message parsing.

7. **`wtp` not found severity** — `ctx.ui.notify(..., "warning")` shown on every `/worktree` attempt (not just once on startup), so the reason for failure is always visible. Note: correct API level is `"warning"` not `"warn"`.

8. **`devcontainer.override.json` regeneration** — Only generated if absent. The user owns the file after first generation and can customise it freely (e.g. add extra mounts or env vars). The extension documents the initial template so users know what they started from.

9. **`pi.events` forwarding (confirmed)** — The pi-dashboard bridge catches all `pi.events.emit` calls via a catch-all shim and forwards them as `event_forward` messages. Unknown channel names are used directly as `eventType`. `pi-dev-worktrees:*` events are forwarded automatically with no bridge changes required.

---

## 12. Non-Goals (v1)

- Multi-devcontainer support (one per worktree) — not planned
- Port assignment / forwarding management — not planned
- Automatic devcontainer start on `session_start` — not planned (user must opt in via `/devcontainer on`)
- Override config customisation — `.pi/devcontainer.override.json` is only generated if absent; users can extend it freely after initial generation
- npm package / global installation — local `.pi/extensions/` only
- Dashboard `ui:list-modules` integration — Phase 2
