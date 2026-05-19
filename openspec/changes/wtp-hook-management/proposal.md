# Proposal: `.wtp.yml` hook management & output surfacing

**Status:** Proposal  
**Date:** 2026-05-19  
**Parent exploration:** `source-spec.md`

---

## Problem statement

`wtp` already has a hook system. When you run `wtp add <branch>` it executes the `post_create` hooks defined in `.wtp.yml` and produces rich progress output:

```
Executing post-create hooks...
→ Running hook 1 of 2...
  Running: npm install
✓ Hook 1 completed
→ Running hook 2 of 2...
  Running: direnv allow
✓ Hook 2 completed
✓ All hooks executed successfully
```

The plugin currently wraps `wtp add` with `execSync` — which **captures all of this output and discards it silently**. The user and LLM see nothing; hook failures are swallowed too (unless `execSync` throws).

Beyond output loss, there is no way to configure what those hooks do from within pi. Users must hand-edit `.wtp.yml` YAML — or accept the plugin's hardcoded default (copy secrets + direnv allow). This is the gap `@zenobius/pi-worktrees` filled by building its own hook runner in TypeScript.

**The better approach for this plugin:** since `wtp` already manages hook execution, we should:
1. **Surface the `wtp add` output** to the user instead of swallowing it
2. **Provide a configuration UI** for the hooks section of `.wtp.yml`, so users can manage their setup commands from within pi rather than editing YAML by hand

This is cleaner than zenobi-us's approach (which reimplements hook execution entirely in TypeScript). We let `wtp` own the execution semantics and just improve the I/O and configurability layer.

---

## Proposed changes

### Change 1 — Surface `wtp add` output during worktree creation

**Current:** `createOrTargetWorktree` calls `execSync("wtp add …")` which captures stdout/stderr, discards it on success, and throws a generic error on failure.

**Proposed:** Switch to `spawnSync` (or `execSync` capturing stdout + surfacing it) so the hook progress output is returned to the caller, which then calls `ctx.ui.notify` to show it.

Because worktree creation happens inside a command handler (which has access to `ctx`), the output can be shown inline. For the tool-based path (LLM calls `worktree_set`), include the hook output in the returned `message`.

Example — what the user would see in the TUI after `/worktree feature/auth`:
```
Worktree active: .pi/worktrees/feature/auth/

Hook output:
→ Running hook 1 of 3...  npm install
✓ Hook 1 completed
→ Running hook 2 of 3...  direnv allow
✓ Hook 2 completed
→ Running hook 3 of 3...  echo "Ready!"
✓ Hook 3 completed
```

If a hook fails, the error output is included and the notification uses `"warning"` severity.

**Affected files:** `worktrees.ts` (change `execSync` → capture+return output), `index.ts` (`worktreeSet` surfaces the output via `ctx.ui.notify`).

---

### Change 2 — `/worktree hooks` command: view and manage `.wtp.yml` post_create hooks

A new subcommand: `/worktree hooks [show | add | remove | clear]`

#### `/worktree hooks` (or `/worktree hooks show`)
Display the current `post_create` hooks from `.wtp.yml` in a readable format:

```
post_create hooks (from .wtp.yml):
  [1] command: npm install
  [2] copy:    .env → .env
  [3] command: direnv allow || true

Use /worktree hooks add <command> to append a command hook.
Use /worktree hooks remove <n> to remove hook by index.
```

If `.wtp.yml` doesn't exist yet, show: `No .wtp.yml found — run /worktree hooks add <cmd> to create one with your first hook.`

#### `/worktree hooks add <command>`
Append a new `type: command` hook to the `hooks.post_create` array in `.wtp.yml`. Creates or extends the file.

Example: `/worktree hooks add npm install`

The hook is written as:
```yaml
- type: command
  command: npm install
```

#### `/worktree hooks remove <index>`
Remove the hook at position `<index>` (1-based). Prompts for confirmation via `ctx.ui.confirm`.

#### `/worktree hooks clear`
Remove all `post_create` hooks after confirmation.

---

### Change 3 — `/worktree init` interactive wizard

Mirror the zenobi-us experience. `/worktree init` runs an interactive sequence:

1. Shows the current `.wtp.yml` state (or says it will create one).
2. Asks: *"What commands should run after worktree creation? (comma-separated, or blank to skip)"* via `ctx.ui.prompt`.
3. Asks: *"Any files to copy from the main worktree? (e.g. .env, .secrets — comma-separated, or blank)"*.
4. Writes (or regenerates) `.wtp.yml` with the collected hooks.
5. Notifies the user with a summary of what was written.

This replaces the current `ensureWtpYml` silent generation with an explicit user-driven setup.

The existing `ensureWtpYml` (auto-generate on first `/worktree <branch>` if absent) is kept as the zero-interaction fallback.

---

## `.wtp.yml` schema reference (for the YAML writer)

wtp supports three hook types in `hooks.post_create`:

```yaml
hooks:
  post_create:
    # Shell command
    - type: command
      command: npm install

    # File/directory copy from main worktree
    - type: copy
      from: .env        # relative to main worktree
      to: .env          # relative to new worktree

    # Symlink from main worktree
    - type: symlink
      from: .bin
      to: .bin
```

The YAML writer in `worktrees.ts` needs to handle all three types for `/worktree hooks show` (display) and `command` type for `/worktree hooks add` (only command hooks are added interactively; copy/symlink are managed via init wizard).

The plugin already has `js-yaml` as a dependency, so YAML parse/stringify is available without adding anything to `package.json`.

---

## Impact summary

| File | Change |
|------|--------|
| `worktrees.ts` | `createOrTargetWorktree` returns `{ path, hookOutput }` instead of just `string`; uses `spawnSync` or `execSync` with captured output |
| `worktrees.ts` | New `readWtpYml`, `writeWtpYml`, `addCommandHook`, `removeHook`, `listHooks` helpers (using `js-yaml`) |
| `index.ts` | `worktreeSet` surfaces `hookOutput` in the `ActionResult.message` |
| `index.ts` | New `/worktree init` handler |
| `index.ts` | Extended `/worktree` handler: `hooks`, `hooks show`, `hooks add <cmd>`, `hooks remove <n>`, `hooks clear` subcommands |

No new dependencies. `js-yaml` already in `package.json`.

---

## What this does NOT do

- Does not reimplement hook execution (that stays in `wtp`)
- Does not add `copy` or `symlink` hook management via `/worktree hooks add` — only `command` type (init wizard handles copy/symlink)
- Does not change the `wtp --exec` flag usage (ad-hoc per-creation commands remain out of scope)
- Does not add per-repo config (separate proposal)
