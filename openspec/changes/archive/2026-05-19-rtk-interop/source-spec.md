# Exploration: `pi-rtk` interoperability & plugin tool-call ordering

**Date:** 2026-05-19
**Status:** Partially addressed (load order docs + conflict detection + user_bash; absorption fallback pending)
**Scope:** Conflict between `pi-dev-worktrees` and RTK-family extensions; RTK-in-container requirement. Three RTK plugins studied. Recommended path: use `pi-rtk-optimizer` with documented load order; absorb internally only if the load-order constraint proves too brittle.

---

## 1. RTK plugin landscape

Three RTK-related pi extensions exist. All studied before proposing an integration approach.

| Plugin | Interception method | Maintenance | What it does |
|--------|--------------------|--------------|--------------|
| `@sherif-fanous/pi-rtk` | `registerTool(createBashTool(..., { spawnHook }))` + `user_bash` | Active | Delegates to `rtk rewrite <cmd>` binary; minimal output processing; session toggle via `/rtk` |
| `mcowger/pi-rtk` | `tool_result` event only | **Stale** (no commits ~3 months) | Pure output compaction pipeline (no command rewriting); 9 configurable techniques; `rtk_configure` LLM tool |
| `MasuRii/pi-rtk-optimizer` | `tool_call` event mutation + `tool_result` event | **Active** (v0.7.1, May 2026) | Command rewriting via `rtk rewrite` binary + rich output compaction pipeline; config file; `/rtk` modal; metrics; actively tracking upstream RTK changes |

### Key observations

**`@sherif-fanous/pi-rtk`** — uses `spawnHook` (execution-time), which fires *after* `tool_call` handlers. Conflicts with `pi-dev-worktrees` because it receives the already-wrapped `devcontainer exec` string. **Not recommended.**

**`mcowger/pi-rtk`** — uses only `tool_result`, no conflict. But it is stale and delegates no active maintenance. Superseded by `pi-rtk-optimizer` which covers a superset of its techniques. **Not recommended for new setups.**

**`MasuRii/pi-rtk-optimizer`** — uses `tool_call` mutation (same layer as `pi-dev-worktrees`). Actively maintained, tracks upstream `rtk` binary evolution, has the richest compaction pipeline. **Recommended.** The critical constraint is load order: `pi-rtk-optimizer` must mutate `event.input.command` *before* `pi-dev-worktrees` wraps it in `devcontainer exec`. Source inspection of `loader.js`, `resource-loader.js`, and `package-manager.js` reveals the **full load order** (see §3.5 for detail). The key finding: `settings.json` `extensions` entries (explicit, local paths) load **before** auto-discovered directory extensions at the same scope. This means explicitly listing `pi-rtk-optimizer` in the project or global `settings.json` `extensions` array gives it a deterministic rank-0 or rank-2 position, ahead of auto-discovered extensions at ranks 1 or 3. **Using the `extensions` array in `settings.json` is the reliable way to control same-scope load order.**

---

## 2. How each plugin intercepts bash commands (detail)

### pi-dev-worktrees — `tool_call` event mutation

`pi-dev-worktrees` hooks the pi `tool_call` event:

```ts
pi.on("tool_call", async (event, ctx) => {
  if (event.toolName !== "bash" || !projectRoot) return;
  // ... state transitions ...
  const result = await applyBashIntercept(cmd, state, projectRoot);
  (event.input as { command: string }).command = result.command;
});
```

`event.input` is mutated in-place. The pi docs guarantee:
> "Later `tool_call` handlers see mutations made by earlier handlers."
> "Handlers run in extension load order."

This operates at the **pre-execution** layer: the command string is rewritten before any tool `execute()` fires.

### pi-rtk — `registerTool` replacement bash tool with `spawnHook`

`pi-rtk` registers a *replacement* bash tool:

```ts
const bashTool = createBashTool(cwd, {
  spawnHook: ({ command, cwd, env }) => ({
    command: rtkRewriteCommand(command) ?? command,
    cwd,
    env,
  }),
});
pi.registerTool(bashTool);
```

This **replaces** the built-in bash tool with a new implementation. The `spawnHook` fires inside `execute()`, at **execution time** — after all `tool_call` event handlers have already run.

From the pi docs: "Extensions can override built-in tools by registering a tool with the same name."

---

## 3. The conflict — refined

### 3.1 `@sherif-fanous/pi-rtk` (spawnHook) — full conflict

As described above: `spawnHook` fires after all `tool_call` handlers. RTK receives the outer `devcontainer exec ... -- sh -c '...'` string, not the inner command. Rewriting it either garbles the quoting or produces a no-op.

### 3.2 `mcowger/pi-rtk` (tool_result only) — no conflict

Pure output compaction via `tool_result`. Works correctly alongside `pi-dev-worktrees` today, with no load-order dependency. The `[container]` or `[host]` prefix added by `pi-dev-worktrees` in `tool_result` is visible to `mcowger/pi-rtk`'s compaction pipeline but does not affect its output-filtering logic.

### 3.3 `MasuRii/pi-rtk-optimizer` (tool_call + tool_result) — load-order-dependent

If `pi-rtk-optimizer` loads **before** `pi-dev-worktrees`: RTK rewrites the raw command → `pi-dev-worktrees` wraps the rewritten command in `devcontainer exec`. The `| rtk compress` pipe ends up running inside the container. **Correct if `rtk` is in the container; incorrect if it isn’t.**

If `pi-dev-worktrees` loads **before** `pi-rtk-optimizer`: `pi-dev-worktrees` wraps first → `pi-rtk-optimizer` tries to rewrite `devcontainer exec ... -- sh -c '...'`. RTK binary returns no match; command runs unchanged (correct by accident). The output compaction in `tool_result` still works.

Load order is determined by precedence rank (see §3.5). Auto-discovered project-local (rank 1) loads before auto-discovered global (rank 3). If `pi-rtk-optimizer` is installed via `pi install` it lands at rank 4 (packages) — **after everything else**, which is wrong. The correct installation is via the `extensions` array in `settings.json` (rank 0 for project, rank 2 for global), which gives a deterministic position before auto-discovered extensions.

### 3.4 The `mcowger/pi-rtk` output compaction techniques are valuable to absorb

All three RTK plugins implement variants of the same output compaction pipeline. The technique implementations in `mcowger/pi-rtk` and `MasuRii/pi-rtk-optimizer` are written in pure TypeScript with no external binary dependency. These techniques (ANSI stripping, build/test/git/linter compaction, source filtering, smart truncation) are the most valuable part of the RTK ecosystem for `pi-dev-worktrees` to absorb — they apply to **both** host and container output, require no `rtk` binary in the container, and work regardless of which command ran.


### 3.5 Full extension load order — source-verified

Tracing `resource-loader.js` → `package-manager.js` → `loader.js` reveals the complete precedence system:

```
Rank  Source                                              How configured
────  ──────────────────────────────────────────────────  ─────────────────────────────────────────
 0    project settings.json "extensions" array (local)   .pi/settings.json → extensions: [...]
 1    project auto-discovered (.pi/extensions/)           readdirSync — filesystem order, no sort
 2    global settings.json "extensions" array (local)    ~/.pi/agent/settings.json → extensions: [...]
 3    global auto-discovered (~/.pi/agent/extensions/)   readdirSync — filesystem order, no sort
 4    packages (settings.json "packages" array)          either settings.json file
```

`toResolvedPaths()` **sorts** by `resourcePrecedenceRank` before deduplication. Lower rank = loads earlier = `tool_call` handler fires first.

**Key insight:** ranks 0 and 2 (explicit `extensions` array entries) are **deterministic** — they load in the exact order they appear in the array. Ranks 1 and 3 (auto-discovered) are **non-deterministic** — `readdirSync` order is filesystem-dependent (creation order on Linux ext4, typically alphabetical on macOS APFS). Rank 4 (`packages`) loads last of all.

**`pi install npm:pi-rtk-optimizer` puts the package at rank 4** — last, after all local extensions. This is the worst possible position for an extension that needs to run before `pi-dev-worktrees`.

### 3.6 Conflict detection via `pi.getAllTools()`

The pi `ExtensionAPI` exposes `pi.getAllTools(): ToolInfo[]` where each `ToolInfo` includes:
- `name` — the tool name (e.g. `"bash"`)
- `sourceInfo.path` — filesystem path to the extension that registered it
- `sourceInfo.scope` — `"user"`, `"project"`, or `"temporary"`
- `sourceInfo.source` — `"local"` (explicit settings entry), `"auto"` (auto-discovered), or `"cli"` (temporary)

Tool registration is **first-registration-wins** (`getAllRegisteredTools` skips names already seen). `tool_call` handlers fire in `this.extensions` array order (same as load order). Both follow the same precedence ranking.

At `session_start`, `pi-dev-worktrees` can detect incompatible bash tool overrides:

```ts
const bashTool = pi.getAllTools().find(t => t.name === "bash");
if (bashTool && isExternalOverride(bashTool.sourceInfo)) {
  // e.g. @sherif-fanous/pi-rtk uses registerTool — fires after tool_call, wrong
  ctx.ui.notify(
    `[pi-dev-worktrees] Warning: bash tool overridden by "${bashTool.sourceInfo.path}". ` +
    `spawnHook-based extensions receive devcontainer exec wrappers, not the inner command. ` +
    `Use pi-rtk-optimizer (configured via settings.json extensions array) instead.`,
    "warning"
  );
}
```

**What cannot be detected:** other extensions' `tool_call` *handlers* — there is no `pi.getToolCallHandlers()` API. `pi-rtk-optimizer` uses `tool_call` mutation and is invisible to tool inspection. Load order is the only reliable signal for it.


## 4. The RTK-in-container requirement

Even if the ordering problem is resolved so that RTK rewrites the *inner* command correctly, there is a second problem: `rtk` is a host binary. When `pi-dev-worktrees` routes through `devcontainer exec`, the inner command runs inside the container's filesystem. RTK compression works by replacing the command with one that pipes through `rtk compress`. If `rtk` is not installed inside the container, the compressed command will fail.

Example of what RTK's rewrite produces for `npm install`:
```sh
# RTK rewritten command (schematic):
npm install 2>&1 | rtk compress
```

If this inner command is then wrapped by `pi-dev-worktrees` for container execution:
```sh
devcontainer exec --container-id abc123 -- sh -c 'npm install 2>&1 | rtk compress'
```

The container does not have `rtk` on its PATH → `rtk compress` is not found → the command fails or produces uncompressed output.

---

## 5. Solution space

### Option A — pi-dev-worktrees migrates to `registerTool` + `spawnHook` (same layer as RTK)

Instead of using `tool_call` mutation, `pi-dev-worktrees` registers its own bash tool replacement using `createBashTool` with a custom `BashOperations.exec` that applies the routing logic:

```ts
const bashTool = createBashTool(cwd, {
  operations: {
    exec: async (command, cwd, options) => {
      const rewritten = await applyBashIntercept(command, state, projectRoot);
      return localBashOperations.exec(rewritten.command, cwd, options);
    },
  },
});
pi.registerTool(bashTool);
```

**Ordering with RTK:**
- If `pi-dev-worktrees` loads first: RTK's tool registration wins (last-wins); RTK's `spawnHook` fires first with the original command, rewrites it. Then... RTK's tool `execute()` runs — `pi-dev-worktrees`'s routing logic never fires. **Wrong.**
- If `pi-dev-worktrees` loads last: its tool registration wins; its `exec` fires first, routes the command. But RTK never runs. **RTK is bypassed entirely.**

There is no load-order-independent way for two `registerTool` overrides to compose. **Option A does not solve the problem unless the two plugins are merged or one delegates to the other explicitly.**

### Option B — pi-dev-worktrees keeps `tool_call` mutation; RTK is applied to the *inner* command

Instead of letting RTK's `spawnHook` receive the outer devcontainer exec string, `pi-dev-worktrees` itself calls `rtk rewrite` on the inner command *before* wrapping it. This requires `pi-dev-worktrees` to be aware of RTK and call `rtk rewrite` as part of its routing logic.

```ts
// In applyBashIntercept, before building the devcontainer exec wrapper:
const inner = rtkRewrite(originalCommand) ?? originalCommand;
// then wrap inner in devcontainer exec
```

**Pros:** Clean separation of concerns; RTK rewrites the right thing (the inner command); no load-order dependency.
**Cons:** `pi-dev-worktrees` has a hard dependency on RTK being present; if RTK is not installed, the call is a no-op, but the code couples the two plugins. RTK's session-enable toggle is not respected.

### Option C — pi-dev-worktrees hooks `tool_call` and un-wraps before passing to next handler, then re-wraps in `tool_result`

A theoretical "middleware" approach where `pi-dev-worktrees` stores the routing metadata and the original unwrapped command, passes a sentinel or the original command to RTK's `spawnHook`, and re-applies the container wrapper inside a custom `tool_result` handler. This is not feasible with the current pi API — there is no way to intercept the command *between* `tool_call` and `spawnHook`.

### Option D — pi introduces a `BashOperations`-based composition API (upstream pi change)

The cleanest solution is for pi to support a `BashOperations` middleware chain, where multiple extensions can each contribute an `exec` wrapper that calls `next(command)`. This would be analogous to Express middleware. Each plugin wraps the `exec` call without needing to know about the other.

```ts
// Hypothetical pi API:
pi.wrapBashExec(async (command, cwd, env, next) => {
  const rewritten = await applyBashIntercept(command, state, projectRoot);
  return next(rewritten.command, cwd, env);
});
```

**Pros:** Load-order-independent; each extension is isolated; composable by design.
**Cons:** Requires a pi core change; not available today.

### Option E — pi-dev-worktrees calls rtk rewrite internally, with optional RTK integration

`pi-dev-worktrees` adds an optional RTK integration path:
1. In `applyBashIntercept`, detect if `rtk` is available on the host PATH.
2. For host commands: do nothing (RTK's own `spawnHook` handles these already, operating on the right command).
3. For container-routed commands: call `rtk rewrite <inner>` on the inner command *before* wrapping it in `devcontainer exec`. If RTK is unavailable or rewrite fails, proceed with the original inner command.
4. For the RTK-in-container problem: install `rtk` in the container (via devcontainer feature or `postCreateHooks`), and use the *container-side* `rtk compress` for output compression by having the inner command itself pipe through `rtk`.

**Pros:**
- No load-order dependency for container commands.
- RTK output compression works inside the container when `rtk` is present there.
- Gracefully degrades when RTK is absent.
- Does not require a pi core change.

**Cons:**
- `pi-dev-worktrees` needs to shell out to `rtk rewrite` itself (duplicates some RTK logic).
- For host-routed commands in the worktree-only path (no container), `pi-dev-worktrees` mutates `event.input.command` and then RTK's `spawnHook` receives the `cd /path && <cmd>` form — RTK will still see the `cd` prefix. This is less severe (RTK can typically handle a `cd && cmd` pattern) but still suboptimal.

### Option F — Move to `tool_call` mutation for RTK (RTK changes its approach)

### Option F — Move to `tool_call` mutation for RTK (RTK changes its approach)

RTK could switch from `registerTool` + `spawnHook` to `pi.on("tool_call", ...)` mutation — the same pattern as `pi-dev-worktrees`. Since `tool_call` handlers run in extension load order and each sees prior mutations, RTK could run *after* `pi-dev-worktrees` and rewrite only the command that `pi-dev-worktrees` already produced. But RTK would then be rewriting `devcontainer exec ... -- sh -c 'npm install'` as a unit, which is the same problem as today. The ordering would need to be reversed: RTK must run *before* `pi-dev-worktrees` in `tool_call` order, rewrite the original inner command, and then `pi-dev-worktrees` wraps the rewritten version. This requires RTK to load before `pi-dev-worktrees`. The only reliable mechanism is listing both in the same `settings.json` `extensions` array with RTK first (rank 0 or rank 2 entries, array-position ordered). However, this approach is fragile in the same direction — it depends on a specific configuration.

---

## 6. Recommended approach — use `pi-rtk-optimizer` with controlled load order

### Primary recommendation

Add `pi-rtk-optimizer` to the **global** `~/.pi/agent/settings.json` `extensions` array (rank 2), and keep `pi-dev-worktrees` as a project-local auto-discovered extension (rank 1) **or** also in a `settings.json` `extensions` array with `pi-rtk-optimizer` listed first. Both approaches give a **deterministic, stable load order** independent of filesystem behavior.

**Do not use `pi install npm:pi-rtk-optimizer`** — this puts it at rank 4 (packages), which loads *after* all local extensions including `pi-dev-worktrees`. Wrong order.

**Recommended setup:**

```json
// ~/.pi/agent/settings.json
{
  "extensions": [
    "path/to/pi-rtk-optimizer"
  ]
}
```

With `pi-dev-worktrees` auto-discovered at `.pi/extensions/pi-dev-worktrees/` (rank 1 — project auto), `pi-rtk-optimizer` at rank 2 loads *after* it. **Still wrong.**

The correct setup requires both in the **same `settings.json` `extensions` array**, listed in order:

```json
// .pi/settings.json  (project-level)
{
  "extensions": [
    "path/to/pi-rtk-optimizer",   // rank 0, listed first
    "path/to/pi-dev-worktrees"    // rank 0, listed second
  ]
}
```

Within rank 0 entries, order is **array position** — fully deterministic. This is the only reliable mechanism.

```
Extension load order (correct):
  1. ~/.pi/agent/extensions/pi-rtk-optimizer  ← global, loads first
  2. .pi/extensions/pi-dev-worktrees          ← project-local, loads second

tool_call chain:
  pi-rtk-optimizer → rewrites "npm install" to "npm install 2>&1 | rtk compress"
  pi-dev-worktrees → wraps it: devcontainer exec … -- sh -c 'cd /ws && npm install 2>&1 | rtk compress'
```

The `rtk compress` pipe then runs inside the container where `rtk` must be present (see §4).

### What to document in pi-dev-worktrees README

1. **Recommended companion:** `pi-rtk-optimizer` installed globally.
2. **Load order rule:** List both in the same `settings.json` `extensions` array with `pi-rtk-optimizer` first. This uses rank-0 (project) or rank-2 (global) explicit entries where **array position is the ordering**. Do not rely on auto-discovery or `pi install` — both produce non-deterministic or wrong ordering.
3. **Do not use `@sherif-fanous/pi-rtk`** alongside `pi-dev-worktrees` — its `spawnHook` fires after routing and produces incorrect results.
4. **RTK-in-container:** `rtk` must be installed in the container for the `| rtk compress` pipe to work. Document the `postCreateHooks` copy approach.
5. **`user_bash` gap:** `pi-dev-worktrees` currently does not hook `user_bash`, so `!<cmd>` bypasses worktree routing. Document as a known limitation.

### Runtime conflict detection in `pi-dev-worktrees`

`pi-dev-worktrees` implements proactive conflict detection at `session_start` using `pi.getAllTools()`:

1. **Detect incompatible bash tool override** (`@sherif-fanous/pi-rtk`): find the registered `bash` tool; if its `sourceInfo` is not the built-in and the extension is known to use `spawnHook`, emit a `warning` notification naming the conflicting extension and explaining why it is incompatible.

2. **Verify `pi-rtk-optimizer` load order**: if `pi-rtk-optimizer` is detected (by checking `getCommands()` for `/rtk`) and both extensions are at the same scope, emit an `info` note: "pi-rtk-optimizer detected — load order within the same directory is filesystem-dependent. On Linux ext4, ensure pi-rtk-optimizer directory predates pi-dev-worktrees to guarantee correct tool_call ordering."

3. **No `tool_call` handler enumeration API exists** — `pi-dev-worktrees` cannot enumerate other extensions' `tool_call` hooks, only their registered tool implementations. This is the fundamental limit; the checks above cover the known cases.

### Fallback: absorb internally if load-order constraint proves brittle

If the `settings.json` `extensions` array approach cannot be relied upon (e.g., the user prefers `pi install`, or managing both extensions in one array is inconvenient), the fallback is to absorb the output compaction pipeline and `rtk rewrite` call directly into `pi-dev-worktrees` (as described in the earlier Option G analysis). This removes the external dependency entirely and is load-order-independent. It represents more maintenance burden but is unambiguously correct.

The spec change for the absorption path already exists in `openspec/changes/rtk-integration/` (partial). It can be completed if the `pi-rtk-optimizer` approach proves brittle in practice.
## 7. Priority ranking

| # | Item | Effort | Value |
|---|------|--------|-------|
| 1 | Install `pi-rtk-optimizer` globally; document load order + incompatible plugins in README | Low | High |
| 2 | Implement conflict detection at `session_start` via `pi.getAllTools()` + `getCommands()` | Low | High (catches misconfiguration early) |
| 3 | RTK-in-container: `postCreateHooks` copy example + README | Low | Medium |
| 4 | Add `user_bash` hook to `pi-dev-worktrees` for worktree/container routing | Low | Medium (closes `!<cmd>` routing gap) |
| 5 | If load-order proves brittle: absorb compaction pipeline internally (`src/output-compactor.ts`) | Medium | High |
| 6 | If load-order proves brittle: absorb `rtk rewrite` call into `applyBashIntercept` | Medium | Medium |
| 7 | Upstream `wrapBashExec` middleware to pi core | High | High (benefits entire ecosystem) |
