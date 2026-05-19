# Spec: `.wtp.yml` hook management & `wtp add` output surfacing

**Status:** Spec  
**Date:** 2026-05-19  
**Change:** `wtp-hook-management`

---

## 1. Overview

This change adds two capabilities to `pi-worktrees`:

1. **`wtp add` output surfacing** — the hook progress narrated by `wtp add` is captured and shown to the user instead of being silently discarded.
2. **`.wtp.yml` hook management** — new subcommands let users view and edit the `post_create` hooks in `.wtp.yml` from within pi, without hand-editing YAML.

---

## 2. Scope

**Affected files:**
- `src/worktrees.ts` — `createOrTargetWorktree` return type; new YAML helpers
- `src/index.ts` — surface hook output; new `/worktree hooks` and `/worktree init` handlers
- `tests/worktrees.test.ts` _(new)_ — unit tests for YAML helpers

**No new dependencies.** `js-yaml` is already in `package.json`.

---

## 3. Requirements

---

### 3.1 `wtp add` output surfacing

#### Requirement: Hook output returned from `createOrTargetWorktree`
`createOrTargetWorktree` SHALL return `{ path: string; hookOutput: string }` instead of `string`.
`hookOutput` is the combined stdout+stderr of the `wtp add` invocation, trimmed.

#### Scenario: New worktree with hooks
- **GIVEN** `.wtp.yml` defines one or more `post_create` hooks
- **WHEN** `createOrTargetWorktree("feature/auth", projectRoot)` is called and the worktree does not yet exist
- **THEN** `wtp add` is called and its full stdout+stderr is captured
- **THEN** `hookOutput` is the captured text, trimmed
- **THEN** `path` is the absolute worktree path

#### Scenario: Existing worktree (no hooks run)
- **WHEN** `createOrTargetWorktree` is called for a worktree path that already exists
- **THEN** `hookOutput` is `""` (no `wtp add` was run)

#### Scenario: Hook failure
- **WHEN** `wtp add` exits non-zero
- **THEN** `createOrTargetWorktree` throws an `Error` whose message includes the captured stdout+stderr so the caller can surface the hook output alongside the failure reason

---

#### Requirement: Hook output shown in TUI after `/worktree <branch>`
After a successful `/worktree <branch>` command, the extension SHALL call `ctx.ui.notify` twice when hook output is non-empty:
1. First call: `"Worktree active: <relPath>/ — bash runs there"` at `"info"` severity
2. Second call: the hook output at `"info"` severity

When hook output is empty (worktree already existed), only the first notify call is made.

#### Scenario: First-time worktree creation with hooks
- **GIVEN** the worktree does not yet exist and `.wtp.yml` has hooks
- **WHEN** `/worktree feature/auth` is run
- **THEN** the user sees two notifications: the worktree-active message, then the hook output

#### Scenario: Re-activating an existing worktree
- **GIVEN** the worktree already exists
- **WHEN** `/worktree feature/auth` is run
- **THEN** the user sees only the worktree-active notification (no empty hook output)

---

### 3.2 `/worktree hooks` subcommands

The `/worktree` command handler is extended to dispatch on a `hooks` prefix. All subcommands require `projectRoot` to be set (git repo guard applies). All subcommands that modify `.wtp.yml` call `ctx.ui.notify` to confirm the change.

---

#### Requirement: `/worktree hooks` (show)
**Usage:** `/worktree hooks` or `/worktree hooks show`

Reads `.wtp.yml`, parses the `hooks.post_create` array, and displays a numbered list.

#### Scenario: Hooks present
- **WHEN** `.wtp.yml` exists and `hooks.post_create` contains entries
- **THEN** `ctx.ui.notify` is called with a formatted string like:
  ```
  post_create hooks (.wtp.yml):
    [1] command:  npm install
    [2] copy:     .env → .env
    [3] symlink:  .bin → .bin
    [4] command:  direnv allow || true

  Use /worktree hooks add <command> to append a command hook.
  Use /worktree hooks remove <n> to remove a hook by index.
  ```

#### Scenario: No `.wtp.yml`
- **WHEN** `.wtp.yml` does not exist
- **THEN** notify: `"No .wtp.yml found. Run /worktree init or /worktree hooks add <cmd> to create one."`

#### Scenario: `.wtp.yml` exists but `hooks.post_create` is empty or absent
- **THEN** notify: `"No post_create hooks defined. Use /worktree hooks add <cmd> to add one."`

---

#### Requirement: `/worktree hooks add <command>`
**Usage:** `/worktree hooks add <shell command>`

Appends a `{ type: command, command: <shell command> }` entry to `hooks.post_create` in `.wtp.yml`. Creates `.wtp.yml` if it doesn't exist (using the default template as a base, replacing the default `hooks.post_create` with just the new entry).

#### Scenario: Normal add
- **GIVEN** `.wtp.yml` exists (or doesn't)
- **WHEN** `/worktree hooks add npm install` is called
- **THEN** `hooks.post_create` gains a new entry `{ type: command, command: "npm install" }`
- **THEN** notify: `"Added hook [<n>]: npm install"`
- **THEN** `.wtp.yml` is written back with valid YAML preserving all existing content

#### Scenario: No argument
- **WHEN** `/worktree hooks add` is called with no argument
- **THEN** notify: `"Usage: /worktree hooks add <command>"` at `"info"` severity

---

#### Requirement: `/worktree hooks remove <n>`
**Usage:** `/worktree hooks remove <index>` (1-based)

Removes the hook at position `n` from `hooks.post_create` after a confirm dialog.

#### Scenario: Valid index, user confirms
- **GIVEN** hook `[2]` is `command: direnv allow`
- **WHEN** `/worktree hooks remove 2` is run and the user confirms
- **THEN** that entry is removed from the array
- **THEN** `.wtp.yml` is written back
- **THEN** notify: `"Removed hook [2]: command: direnv allow"`

#### Scenario: Valid index, user cancels
- **WHEN** user declines the confirm dialog
- **THEN** `.wtp.yml` is unchanged; notify: `"Cancelled"`

#### Scenario: Invalid index
- **WHEN** the index is out of range or not a number
- **THEN** notify: `"Invalid index. Run /worktree hooks to see hook numbers."` at `"warning"`

#### Scenario: No `.wtp.yml` or empty hooks
- **THEN** notify: `"No hooks to remove."` at `"info"`

---

#### Requirement: `/worktree hooks clear`
**Usage:** `/worktree hooks clear`

Removes all entries from `hooks.post_create` after a confirm dialog.

#### Scenario: Hooks present, user confirms
- **WHEN** the user confirms
- **THEN** `hooks.post_create` is set to `[]`
- **THEN** `.wtp.yml` is written back
- **THEN** notify: `"Cleared all post_create hooks."`

#### Scenario: User cancels
- **THEN** notify: `"Cancelled"` — `.wtp.yml` unchanged

#### Scenario: No hooks
- **THEN** notify: `"No post_create hooks to clear."` at `"info"`

---

### 3.3 `/worktree init` interactive wizard

#### Requirement: `/worktree init` creates or reconfigures `.wtp.yml` interactively
**Usage:** `/worktree init`

Runs a guided sequence to set up (or reset) `.wtp.yml`. Steps:

1. If `.wtp.yml` exists: ask `ctx.ui.confirm("Regenerate .wtp.yml?", "This will overwrite existing hooks and settings.")` — if declined, abort and notify.
2. Ask `ctx.ui.input("Setup commands (comma-separated, blank to skip):", "npm install, mise install")` — each non-blank entry becomes a `type: command` hook.
3. Ask `ctx.ui.input("Files to copy from main worktree (comma-separated, blank to skip):", ".env, .secrets")` — each non-blank entry becomes a `type: copy` hook with `from: <f>, to: <f>`.
4. Write `.wtp.yml` with `defaults.base_dir: ".pi/worktrees"` and the collected hooks (secrets-copy and direnv hooks are not auto-inserted when the user has explicitly configured hooks via init).
5. Notify with a summary of what was written.

#### Scenario: Full init flow
- **GIVEN** the user runs `/worktree init`, confirms regeneration (if file exists), enters `"npm install, mise install"` and `".env"`
- **THEN** `.wtp.yml` is written with three `post_create` hooks: `npm install`, `mise install`, `copy .env → .env`
- **THEN** notify: `"Written .wtp.yml with 3 post_create hooks."`

#### Scenario: Blank inputs
- **GIVEN** the user enters blank for both inputs
- **THEN** `.wtp.yml` is written with the default template (same as `ensureWtpYml`)
- **THEN** notify: `"Written .wtp.yml with default hooks."`

---

## 4. YAML helper contract (`worktrees.ts`)

```typescript
// Parse .wtp.yml; returns null if file doesn't exist
function readWtpYml(projectRoot: string): WtpConfig | null

// Write WtpConfig back to .wtp.yml as YAML
function writeWtpYml(projectRoot: string, config: WtpConfig): void

// Return the post_create hooks array (empty array if absent)
function listHooks(config: WtpConfig): WtpHook[]

// Append a command hook; returns updated config
function addCommandHook(config: WtpConfig, command: string): WtpConfig

// Remove hook at 1-based index; throws RangeError if out of bounds
function removeHook(config: WtpConfig, index: number): WtpConfig

// Format a single hook for display (e.g. "command:  npm install")
function formatHook(hook: WtpHook): string
```

Types:
```typescript
interface WtpConfig {
  version?: string;
  defaults?: { base_dir?: string; [key: string]: unknown };
  hooks?: { post_create?: WtpHook[] };
  [key: string]: unknown;
}

type WtpHook =
  | { type: "command"; command: string }
  | { type: "copy"; from: string; to: string }
  | { type: "symlink"; from: string; to: string }
  | Record<string, unknown>;
```

`readWtpYml` uses `js-yaml`'s `load()`. `writeWtpYml` uses `dump()` with `{ lineWidth: -1, noRefs: true }`.

---

## 5. `createOrTargetWorktree` return type change

```typescript
// Before
export function createOrTargetWorktree(branch: string, projectRoot: string): string

// After
export interface CreateWorktreeResult {
  path: string;
  hookOutput: string;
}
export function createOrTargetWorktree(branch: string, projectRoot: string): CreateWorktreeResult
```

Implementation: replace `execSync("wtp add …", { encoding: "utf8" })` with a call that captures both stdout and stderr (via `execSync` with `stdio` piped, or `spawnSync`). The combined output is returned as `hookOutput`.

All callers in `index.ts` (`worktreeSet`) are updated to destructure `{ path, hookOutput }`.

---

## 6. `/worktree` command dispatch update

The `/worktree` command handler currently checks for `""`, `"off"`, and any branch name. It is extended to check for `"hooks …"` and `"init"` prefixes **before** falling through to the branch-name path.

Dispatch table (first match):
1. `""` → status
2. `"off"` → worktreeOff
3. `"init"` → worktreeInit (new)
4. `"hooks"` or `"hooks show"` → worktreeHooksShow (new)
5. `"hooks add <cmd>"` → worktreeHooksAdd (new)
6. `"hooks remove <n>"` → worktreeHooksRemove (new)
7. `"hooks clear"` → worktreeHooksClear (new)
8. anything else → worktreeSet (existing, treats arg as branch name)
