## Context

`pi-dev-worktrees` delegates worktree creation to `wtp add`, which already executes `post_create`
hooks and streams rich progress output to the terminal. The plugin currently calls `wtp add`
via `execSync` — a mode that captures stdout/stderr into a string, discards it on success,
and only surfaces a generic error message on failure. Hook output is permanently lost.

Users who want to change what hooks run must hand-edit `.wtp.yml` YAML outside of pi. The
plugin auto-generates a default `.wtp.yml` on first use (via `ensureWtpYml`) but provides no
way to inspect or modify it afterwards from within the session.

**The `wtp` hook schema** supports three types in `hooks.post_create`:
- `type: command` — run a shell command in the new worktree
- `type: copy` — copy a file/dir from the main worktree to the new one
- `type: symlink` — symlink from main to new

The extension already depends on `js-yaml` (used elsewhere) so YAML round-trip is available
without adding any dependencies.

---

## Goals / Non-Goals

**Goals:**
- Surface the full `wtp add` hook progress output to the user after worktree creation
- Let users view `post_create` hooks from within pi without opening `.wtp.yml`
- Let users add and remove `command`-type hooks via slash commands
- Provide an interactive `/worktree init` wizard for initial setup (commands + copy files)
- Keep `wtp` as the hook executor — don't reimplement what `wtp` already does

**Non-Goals:**
- Adding `copy` or `symlink` hooks via `/worktree hooks add` (init wizard covers these)
- Per-repo config file (separate proposal)
- Hook reordering (append-only add, index-based remove is sufficient)
- Editing existing hook values in-place (remove + add is the workflow)

---

## Decisions

### D1 — `spawnSync` to capture `wtp add` output, not `execSync`

`execSync` can capture stdout via `{ stdio: ["ignore", "pipe", "pipe"] }`, but `spawnSync`
is cleaner for capturing both streams: it returns `{ stdout, stderr, status }` in one call
with no shell wrapping.

**Implementation:** `spawnSync("wtp", args, { encoding: "utf8", cwd: projectRoot })`.
Combined output is `(result.stdout + result.stderr).trim()`. Non-zero `status` throws an
`Error` with the combined output in the message so hook failures surface full context.

**Alternative:** keep `execSync`, pass `{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }`
and catch + re-throw. Rejected — `spawnSync` avoids shell quoting of the arg list and is
the idiomatic Node.js API for synchronous subprocess capture with separate stream access.

**Alternative:** `execFileSync`. Functionally identical to `spawnSync` for this use-case;
`spawnSync` was chosen because it is already used elsewhere in the codebase.

### D2 — Hook output surfaced as a second `ctx.ui.notify` call, not merged into one

After a successful `/worktree <branch>`, two notifications fire when hook output is non-empty:
1. `"Worktree active: .pi/worktrees/feature/auth/ — bash runs there"` (the existing message)
2. The raw `wtp add` output (hook progress)

**Rationale:** keeping them separate means the worktree-active message is always concise and
readable even when hooks produce verbose output (e.g. `npm install` printing hundreds of
lines). Users can dismiss or scroll the hook output independently.

**Alternative:** Append hook output to the `ActionResult.message` in one string. Rejected —
the combined message would be too long for the TUI notify card and would pollute the
concise worktree-active signal.

**Alternative:** Show hook output only when it contains errors (non-zero exit). Rejected —
hook *success* output (e.g. `mise install` confirming tool versions) is genuinely useful
feedback that confirms the worktree is ready to use.

### D3 — YAML round-trip via `js-yaml` `load()` / `dump()` with `{ lineWidth: -1, noRefs: true }`

`js-yaml` is already in `package.json`. `load()` handles the comment-free `.wtp.yml` format
(comments in the generated file would be stripped on first `writeWtpYml` call, which is
acceptable — the file was auto-generated and comments are purely decorative).

`dump()` options: `lineWidth: -1` prevents unwanted line-wrapping of long command strings;
`noRefs: true` prevents YAML anchors/aliases in output which would confuse `wtp`'s parser.

**Alternative:** String manipulation / regex-based YAML patching to preserve comments.
Rejected — fragile and disproportionate to the need. Users who care about comments in
`.wtp.yml` are editing it by hand anyway, not using the hook management commands.

**Alternative:** `yaml` package (the popular ESM-native library with comment preservation).
Rejected — would add a new runtime dependency; `js-yaml` already present is sufficient.

### D4 — Only `type: command` hooks addable via `/worktree hooks add`; `copy`/`symlink` via init wizard only

`/worktree hooks add <cmd>` appends `{ type: "command", command: "<cmd>" }`. The `add`
command does not support `copy` or `symlink` types because their two-field form
(`from`/`to`) doesn't fit the single-string argument cleanly.

The `/worktree init` wizard handles `copy` hooks by asking for a comma-separated list of
filenames and generating `{ type: "copy", from: f, to: f }` entries.

**Alternative:** `/worktree hooks add --copy .env:.env`. Rejected — POSIX-style flags in
slash commands are unusual in the pi UX; the init wizard is a better entry point for
structured hook types.

### D5 — `/worktree init` uses `ctx.ui.input` with `ctx.ui.confirm` for overwrite guard

Two `ctx.ui.input` calls collect commands (comma-separated) and copy-files (comma-separated).
An optional leading `ctx.ui.confirm` guards against silent overwrite of a user-customised
`.wtp.yml`.

Blank inputs fall back to the default template (same output as `ensureWtpYml`) so `/worktree init`
is a safe no-op for users who are happy with the defaults.

**Alternative:** Multi-step wizard with one `input` per hook. Rejected — overkill for the
typical 1–3 hooks case; comma-separated is the same convention `wtp`'s own `init` output
uses for example arrays.

### D6 — `formatHook` uses type-specific display for `command`, `copy`, `symlink`; falls back to JSON for unknown types

```
command:  npm install
copy:     .env → .env
symlink:  .bin → .bin
unknown:  {"type":"custom","opts":{}}
```

The `→` arrow is chosen to match the visual language `wtp` itself uses in hook progress
output (`→ Running hook 1 of 2...`).

### D7 — `/worktree` dispatch: hook subcommands checked before branch-name fallthrough

The dispatch table in `index.ts` extends the existing `""` / `"off"` checks with explicit
string prefix matching for `"init"`, `"hooks"`, `"hooks show"`, `"hooks add "`,
`"hooks remove "`, `"hooks clear"`. All new checks come before the branch-name fallthrough
so that e.g. `/worktree hooks` isn't mistaken for a branch named `hooks`.

**Risk:** a user who happens to have a branch named `hooks`, `init`, etc. cannot target it
directly via the `/worktree` command. Mitigation: these are reserved subcommand names;
the user can still create such a branch with `git branch hooks && /worktree hooks` (the
first `/worktree hooks` would show the hooks list, not create a worktree). This is an
acceptable trade-off given how unlikely such branch names are in practice.

---

## Risks / Trade-offs

- **`wtp add` output format stability**: `wtp` may change its hook progress format in future
  versions. The output is surfaced as a raw string to `ctx.ui.notify` — no parsing is done,
  so format changes are not breaking. The user may see different text, but no error.

- **Long hook output in TUI notify**: `npm install` or similar can produce hundreds of lines.
  The TUI notify card scrolls, so this is usable but visually heavy. If this becomes a pain
  point, a future change could truncate to the last N lines with a note.

- **`js-yaml` `dump()` drops comments**: any comments in a user's `.wtp.yml` are lost on the
  first write-back from a hook management command. This is documented in the command output
  (`/worktree hooks add` notifies that the file was updated). Users who maintain hand-crafted
  `.wtp.yml` files with comments should use `git diff` to review changes.

- **Branch names colliding with subcommand names**: reserved names `init`, `hooks` — very
  unlikely in practice but theoretically a usability issue. Documented in D7 above.

- **`spawnSync` blocks the event loop**: `wtp add` can take 30+ seconds when `npm install`
  runs as a hook. `spawnSync` is inherently blocking. This is acceptable in the command handler
  context (user explicitly typed `/worktree <branch>`) but would be unacceptable in a
  `tool_call` handler. The `worktreeSet` function is only called from command handlers, not
  from tool hooks. If tool-path worktree creation is ever needed with hooks, an async spawn
  would be required.

---

## Migration Plan

1. Update `createOrTargetWorktree` in `worktrees.ts` to use `spawnSync` and return
   `CreateWorktreeResult`; add YAML helpers (`readWtpYml`, `writeWtpYml`, etc.)
2. Update `worktreeSet` in `index.ts` to destructure `{ path, hookOutput }` and fire the
   second `ctx.ui.notify`
3. Add `worktreeHooksShow`, `worktreeHooksAdd`, `worktreeHooksRemove`, `worktreeHooksClear`,
   `worktreeInit` functions in `index.ts`
4. Extend `/worktree` dispatch table in `index.ts` command handler
5. Add unit tests in `tests/worktrees.test.ts` for all YAML helpers

No data migration needed — `.wtp.yml` format is unchanged; existing files continue to work
without modification. The only visible change to existing users is a second notify after
worktree creation when hooks produce output.

Rollback: revert `worktrees.ts` and `index.ts`; the `CreateWorktreeResult` interface change
is backwards-compatible with an alias `type CreateWorktreeResult = string` if needed as a
shim during rollback.
