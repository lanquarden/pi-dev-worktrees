# Design: Per-Repo Config for worktreeRoot Override

## D1 — Config File Location

**Decision:** `~/.pi/agent/pi-dev-worktrees.config.json`

**Rationale:** `~/.pi/agent/` is the established global config directory for pi plugins (the peer plugin `@zenobius/pi-worktrees` follows the same convention). Placing the file there keeps all pi agent config in one discoverable location and avoids polluting `$HOME` with a top-level dotfile.

---

## D2 — Schema

```json
{
  "repos": [
    {
      "repoGlob": "github.com/myorg/*",
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

`repoGlob` is matched against the `origin` remote URL (as returned by `git remote get-url origin`). The `repos` array is evaluated in order; the first entry whose `repoGlob` matches the remote URL wins. If no entry matches, the hardcoded default `.pi/worktrees` is used.

`worktreeRoot` is treated as a path. If it is absolute, it is used as-is. If it is relative, it is resolved relative to `projectRoot`.

`postCreateHooks` is optional. When present, the entries are **appended** to the two default hooks already in `WTP_YML_CONTENT` (copy-secrets + direnv allow) when `ensureWtpYml` generates the file. The hook schema matches `WtpHook` from `worktrees.ts` (`type: command | copy | symlink`). If the `.wtp.yml` already exists, `ensureWtpYml` does not overwrite it — the caller must explicitly delete it or use `/worktree init` to regenerate.

---

## D3 — Glob Matching

**Decision:** Hand-rolled single-pass `*` wildcard matcher. No external dependency.

Rules:
- `*` matches any sequence of characters including `/`.
- Matching is case-sensitive.
- No support for `?`, `**`, character classes, or regex.

This is sufficient to express the common patterns:
- `github.com/myorg/*` — all repos in an org
- `github.com/myorg/specific-repo` — one repo
- `*` — catch-all fallback

---

## D4 — Remote URL Resolution

The `origin` remote URL is resolved once during `session_start` via:

```
git remote get-url origin
```

The result is stored in a module-level variable alongside `projectRoot`. If the repo has no `origin` remote (local-only repo or detached), the command will fail; in that case the remote URL is treated as an empty string, config matching is skipped entirely, and the default `.pi/worktrees` is used. No error is surfaced to the user.

---

## D5 — resolvedWorktreeRoot Threading

`resolvedWorktreeRoot` replaces every hardcoded `.pi/worktrees` reference in the codebase:

- `createOrTargetWorktree` — accepts `worktreeRoot` as a parameter; uses it to build the worktree path instead of the hardcoded constant.
- `ensureWtpYml` — accepts `worktreeRoot` as a parameter; substitutes it into `WTP_YML_CONTENT` at write time rather than embedding the value in the template string.
- `enumerateWorktreeDirs` call in `/workspace-cleanup` — receives the resolved value.

All three call sites receive the value from `session_start`, which resolves it once and holds it for the lifetime of the session.

---

## D6 — Config Load Timing

Config is loaded once at `session_start`. It is not re-read on subsequent commands. If the user edits the config file mid-session, the change takes effect on the next pi session restart. This is acceptable because path overrides are stable machine-level settings that change infrequently.

---

## D7 — Missing or Malformed Config

- **File absent:** silently ignored; default `.pi/worktrees` is used.
- **File present, valid JSON:** parsed and used normally.
- **File present, invalid JSON:** `console.warn` is emitted with the file path and the parse error message; the default `.pi/worktrees` is used. No exception is thrown.

---

## D8 — New File: src/config.ts

Three helpers are extracted into a dedicated module to keep `worktrees.ts` focused on wtp operations:

| Export | Signature | Purpose |
|---|---|---|
| `PluginConfig` | `type` | Shape of the parsed JSON config |
| `RepoEntry` | `type` | Single entry in `repos` array (`repoGlob`, `worktreeRoot`, optional `postCreateHooks`) |
| `loadPluginConfig` | `() => PluginConfig \| null` | Reads and parses `~/.pi/agent/pi-dev-worktrees.config.json` |
| `matchRepoGlob` | `(pattern: string, url: string) => boolean` | Single-pass `*` wildcard match |
| `resolveWorktreeRoot` | `(remoteUrl: string, config: PluginConfig \| null) => string` | Returns the first matching `worktreeRoot` or the default |
| `resolvePostCreateHooks` | `(remoteUrl: string, config: PluginConfig \| null) => WtpHook[]` | Returns the `postCreateHooks` of the first matching entry, or `[]` |
