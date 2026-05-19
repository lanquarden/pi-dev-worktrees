# Proposal: `pi-rtk-optimizer` interop — load order, conflict detection, user_bash, RTK-in-container

**Status:** Proposal
**Date:** 2026-05-19
**Parent exploration:** `openspec/changes/rtk-interop/source-spec.md`

---

## Why

`MasuRii/pi-rtk-optimizer` is the recommended companion extension for token compression. It uses `pi.on("tool_call", ...)` mutation — the same interception layer as `pi-dev-worktrees`. For the two to compose correctly, `pi-rtk-optimizer` must mutate `event.input.command` (rewriting the raw inner command) *before* `pi-dev-worktrees` wraps it in `devcontainer exec`.

Source analysis of pi's `package-manager.js` reveals the full precedence ranking. Within the same precedence rank, order is **array position** in the `settings.json` `extensions` field — fully deterministic. This is the only reliable mechanism; `pi install` (rank 4 packages) loads after all local extensions and is the wrong approach.

Three additional gaps are addressed in this change:

1. **Conflict detection:** `@sherif-fanous/pi-rtk` uses `spawnHook` (fires after `tool_call`) and must not be loaded alongside `pi-dev-worktrees`. Detectable via `pi.getAllTools()`.
2. **`user_bash` routing gap:** `pi-dev-worktrees` does not currently hook `user_bash`, so `!<cmd>` commands bypass worktree cd and container exec routing entirely.
3. **RTK-in-container:** when `rtk rewrite` produces a command containing `| rtk compress`, that pipe must succeed inside the container. Documentation and a `postCreateHooks` example are needed.

---

## Problem statement

1. **Non-deterministic load order:** `pi install npm:pi-rtk-optimizer` places it at rank 4 (packages), after all local extensions — the wrong order. Auto-discovered extensions (`readdirSync`) have no sort guarantee on Linux ext4.
2. **Silent misconfiguration:** if `@sherif-fanous/pi-rtk` is loaded, its `spawnHook` receives the devcontainer exec wrapper instead of the inner command — incorrect and invisible to the user.
3. **`user_bash` bypass:** `!npm install` runs on the host without worktree `cd` or container exec, even when a worktree or container is active.
4. **`rtk compress` missing in container:** if `rtk` is not installed in the container, commands rewritten by `pi-rtk-optimizer` will fail silently when routed via `devcontainer exec`.

---

## Proposed solution

### 1. `settings.json` load order documentation and tooling

Document that both extensions must be listed in the **same** `settings.json` `extensions` array, `pi-rtk-optimizer` first. Provide a ready-to-use snippet in the README.

Rank 0 (project `settings.json` `extensions` array) entries load in **array order** — deterministic and stable. This beats auto-discovered directories (rank 1/3) and `pi install` packages (rank 4).

```json
// .pi/settings.json
{
  "extensions": [
    "/path/to/pi-rtk-optimizer",
    "/path/to/pi-dev-worktrees"
  ]
}
```

If the user prefers global configuration:

```json
// ~/.pi/agent/settings.json
{
  "extensions": [
    "/path/to/pi-rtk-optimizer",
    "/path/to/pi-dev-worktrees"
  ]
}
```

### 2. Conflict detection at `session_start`

At `session_start`, call `pi.getAllTools()` to inspect the registered `bash` tool:

- If the bash tool's `sourceInfo.path` matches a known `spawnHook`-based extension (currently `@sherif-fanous/pi-rtk`), emit a `warning` notification explaining the incompatibility and the correct alternative.
- If the bash tool has been replaced by *any* non-built-in extension that is not `pi-dev-worktrees` itself, emit a generic `warning` that the bash tool override may interfere with routing.

Call `pi.getCommands()` to detect if `pi-rtk-optimizer` is loaded (it registers `/rtk`). If it is, also verify load order by checking `pi.getAllTools()` for the position of `pi-dev-worktrees`'s own registration vs `pi-rtk-optimizer`'s. If order cannot be confirmed, emit an `info` advisory with the `settings.json` snippet.

### 3. `user_bash` routing hook

Add a `user_bash` handler to `pi-dev-worktrees`. For non-`!!` commands:
- Apply the same decision table as `applyBashIntercept` (worktree `cd` prefix, container exec wrap).
- Return `{ operations: { exec: ... } }` using `createLocalBashOperations` for host execution, or spawn the container exec command directly for container-routed commands.
- `!!` commands (`event.excludeFromContext === true`) are intentionally not intercepted — same policy as `pi-rtk`.

### 4. RTK-in-container documentation and advisory

When the devcontainer becomes ready (`starting` → `false`) and `pi-rtk-optimizer` is detected loaded, probe `rtk --version` inside the container. If it fails, emit a one-time `info` notification with the `postCreateHooks` copy snippet.

Document in README: if `pi-rtk-optimizer` rewrites a command to include `| rtk compress`, that pipe runs inside the container. `rtk` must be available there.

---

## Alternatives not taken

**`pi install npm:pi-rtk-optimizer`** — puts extension at rank 4, loads after all local extensions. Wrong order, not documented as correct.

**Absorb compaction/rewrite internally** — removes the external dependency entirely and is order-independent. Retained as the fallback path if the `settings.json` approach proves too cumbersome for users. Spec skeleton exists, can be completed separately.

**Upstream `wrapBashExec` middleware to pi** — the correct long-term fix. Tracked separately; does not block this change.
