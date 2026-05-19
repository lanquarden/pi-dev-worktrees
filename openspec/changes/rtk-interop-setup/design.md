# Design: `pi-rtk-optimizer` interop

## Context

Pi's extension load order is determined by `resourcePrecedenceRank` in `package-manager.js`:

| Rank | Source | Ordering within rank |
|------|--------|---------------------|
| 0 | Project `settings.json` `extensions` array | Array position — deterministic |
| 1 | Project auto-discovered (`.pi/extensions/`) | `readdirSync` — filesystem order |
| 2 | Global `settings.json` `extensions` array | Array position — deterministic |
| 3 | Global auto-discovered (`~/.pi/agent/extensions/`) | `readdirSync` — filesystem order |
| 4 | `packages` array (`pi install`) | Package resolution order |

`tool_call` handlers fire in `this.extensions` order (same as load order). `registerTool` is first-registration-wins across the same ordered list.

`pi.getAllTools()` returns `ToolInfo[]` with `sourceInfo.path`, `sourceInfo.scope` (`"project"` / `"user"` / `"temporary"`), `sourceInfo.source` (`"local"` / `"auto"` / `"cli"`). `pi.getCommands()` returns registered slash commands with source metadata.

---

## Decisions

### D1 — `settings.json` `extensions` array is the only reliable ordering mechanism

Auto-discovered directories (ranks 1, 3) use `readdirSync` with no sort. On Linux ext4 this is inode creation order; on macOS APFS typically alphabetical. Neither is guaranteed. `pi install` (rank 4) always loads last. Only ranks 0 and 2 (`extensions` array entries) have stable, user-controlled ordering via array position.

**Implementation:** README documents the `settings.json` snippet. No code change required for the ordering itself — it is a configuration concern.

### D2 — Conflict detection uses `pi.getAllTools()` + `pi.getCommands()` at `session_start`

`pi.getAllTools()` surfaces which extension registered the `bash` tool and where it came from. `pi.getCommands()` surfaces whether `/rtk` is registered (indicating `pi-rtk-optimizer` or similar is loaded).

Two checks:

**Check A — incompatible bash tool override:**
```ts
const bashTool = pi.getAllTools().find(t => t.name === "bash");
const isOverridden = bashTool && bashTool.sourceInfo.source !== "built-in"
  && !bashTool.sourceInfo.path.includes("pi-dev-worktrees");
```
If overridden, warn. The check is path-based since there is no "is spawnHook" introspection API. A path containing `pi-rtk` but not `pi-rtk-optimizer` is the known bad case.

**Check B — pi-rtk-optimizer load order advisory:**
```ts
const hasRtkOptimizer = pi.getCommands().some(c => c.name === "rtk");
```
If detected, also check `bashTool.sourceInfo` for whether `pi-dev-worktrees` or `pi-rtk-optimizer` registered `bash` first (first-registration-wins means whoever loaded first holds the bash tool if both tried to register it — but neither does, so the check is indirect). Emit an `info` advisory with the `settings.json` snippet if load order cannot be confirmed.

**Alternative:** check `pi.getAllTools()` for a tool named `rtk_rewrite` or inspect tool names for rtk-specific registrations. Rejected — `pi-rtk-optimizer` does not register a tool named `rtk_rewrite`; command-based detection (`/rtk`) is more stable.

### D3 — `user_bash` uses `createLocalBashOperations` for host commands, direct spawn for container

The `user_bash` event handler returns `{ operations: { exec } }`. For host-routed commands, delegate to `createLocalBashOperations().exec` with the rewritten command string (worktree `cd` prefix applied). For container-routed commands, spawn `devcontainer exec ... -- sh -c '...'` directly using `createLocalBashOperations().exec`.

`!!` commands (`event.excludeFromContext === true`) are passed through unchanged — same as `pi-rtk-optimizer` policy. User opted out of context inclusion; routing would be surprising.

**Alternative:** mutate `event.command` in-place rather than returning `operations`. The `user_bash` API returns `operations` to override exec; mutating the command without returning operations falls through to pi's normal handler. Returning `operations` gives full control.

### D4 — RTK-in-container probe is fire-and-forget, one-time per container session

At container-ready transition (when `state.devcontainer.starting` flips to `false`), if `pi-rtk-optimizer` is detected (D2 Check B), run `devcontainer exec ... -- rtk --version` asynchronously. Store result as `containerRtkAvailable` in state. If false, emit one-time `info` notification. Probe is not repeated unless the container is restarted.

**Why async:** container probes can take 1–2 seconds; blocking `session_start` or a `tool_call` handler is unacceptable.

### D5 — Advisory messages are `info`, not `warning`, except for incompatible override

The `spawnHook` incompatibility (Check A) is a `warning` — it will silently produce wrong behavior. The load order advisory (Check B) is `info` — the user may have intentionally configured things differently, or may not be using the container path where order matters. The RTK-in-container probe failure is `info` — not an error until a rewritten command actually fails.

### D6 — No new persistent state for RTK probes

`hostRtkAvailable` and `containerRtkAvailable` are in-memory only. They are re-evaluated each `session_start` and each container-ready transition respectively. No change to the session persistence schema.
