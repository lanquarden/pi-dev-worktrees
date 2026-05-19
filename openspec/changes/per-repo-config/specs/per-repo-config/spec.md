# Spec: Per-Repo Config for worktreeRoot Override

**Version:** 0.1.0
**Date:** 2026-05-19

---

## 1. loadPluginConfig

### SHALL-1.1
`loadPluginConfig()` SHALL return `null` when `~/.pi/agent/pi-dev-worktrees.config.json` does not exist.

### SHALL-1.2
`loadPluginConfig()` SHALL return a `PluginConfig` object when the file exists and contains valid JSON conforming to the schema `{ repos: Array<{ repoGlob: string, worktreeRoot: string }> }`.

### SHALL-1.3
`loadPluginConfig()` SHALL return `null` and emit a `console.warn` containing the file path and the JSON parse error message when the file exists but contains invalid JSON. It SHALL NOT throw.

### Scenario 1.A — File absent
```
Given: ~/.pi/agent/pi-dev-worktrees.config.json does not exist
When:  loadPluginConfig() is called
Then:  returns null
And:   no warning is emitted
```

### Scenario 1.B — Valid config
```
Given: ~/.pi/agent/pi-dev-worktrees.config.json contains
       { "repos": [{ "repoGlob": "github.com/org/*", "worktreeRoot": "/ssd/wt",
                     "postCreateHooks": [{ "type": "command", "command": "mise install" }] }] }
When:  loadPluginConfig() is called
Then:  returns the parsed object including the postCreateHooks array
```

### Scenario 1.C — Invalid JSON
```
Given: ~/.pi/agent/pi-dev-worktrees.config.json contains "{ not valid json }"
When:  loadPluginConfig() is called
Then:  returns null
And:   console.warn is called with a message containing the file path and parse error
```

---

## 2. matchRepoGlob

### SHALL-2.1
`matchRepoGlob(pattern, url)` SHALL return `true` when `pattern` equals `url` exactly (no wildcards).

### SHALL-2.2
`matchRepoGlob(pattern, url)` SHALL return `true` when `pattern` contains one or more `*` characters and the `url` matches after substituting each `*` with any sequence of characters (including empty string and `/`).

### SHALL-2.3
`matchRepoGlob(pattern, url)` SHALL return `false` when the `url` does not match the `pattern`.

### SHALL-2.4
`matchRepoGlob` SHALL be case-sensitive.

### SHALL-2.5
`matchRepoGlob` SHALL NOT treat `?`, `**`, or bracket expressions as special characters — only `*` is a wildcard.

### Scenario 2.A — Exact match
```
matchRepoGlob("github.com/org/repo", "github.com/org/repo") => true
```

### Scenario 2.B — Wildcard org match
```
matchRepoGlob("github.com/org/*", "github.com/org/my-repo") => true
matchRepoGlob("github.com/org/*", "github.com/org/other-repo") => true
```

### Scenario 2.C — Wildcard does not match across domains
```
matchRepoGlob("github.com/org/*", "gitlab.com/org/repo") => false
```

### Scenario 2.D — Catch-all
```
matchRepoGlob("*", "github.com/anything/at-all") => true
matchRepoGlob("*", "") => true
```

### Scenario 2.E — No match
```
matchRepoGlob("github.com/a/*", "github.com/b/repo") => false
```

### Scenario 2.F — Case sensitivity
```
matchRepoGlob("github.com/Org/*", "github.com/org/repo") => false
```

---

## 3. resolveWorktreeRoot

### SHALL-3.1
`resolveWorktreeRoot(remoteUrl, config)` SHALL iterate `config.repos` in order and return the `worktreeRoot` of the first entry whose `repoGlob` matches `remoteUrl`.

### SHALL-3.2
`resolveWorktreeRoot(remoteUrl, config)` SHALL return `".pi/worktrees"` when no entry in `config.repos` matches `remoteUrl`.

### SHALL-3.3
`resolveWorktreeRoot(remoteUrl, null)` SHALL return `".pi/worktrees"`.

### SHALL-3.4
`resolveWorktreeRoot` SHALL NOT modify or sort `config.repos` — first-match-wins order is determined by array position.

### Scenario 3.A — First match wins
```
Given: config.repos = [
         { repoGlob: "github.com/org/specific", worktreeRoot: "/ssd/specific" },
         { repoGlob: "github.com/org/*",         worktreeRoot: "/ssd/org" },
         { repoGlob: "*",                         worktreeRoot: ".pi/worktrees" }
       ]
And:   remoteUrl = "github.com/org/specific"
Then:  returns "/ssd/specific"
```

### Scenario 3.B — Falls back to second entry
```
Given: same config as 3.A
And:   remoteUrl = "github.com/org/other"
Then:  returns "/ssd/org"
```

### Scenario 3.C — No match → default
```
Given: config.repos = [{ repoGlob: "github.com/org/*", worktreeRoot: "/ssd/org" }]
And:   remoteUrl = "gitlab.com/other/repo"
Then:  returns ".pi/worktrees"
```

### Scenario 3.D — Null config → default
```
Given: config = null
And:   remoteUrl = "github.com/org/repo"
Then:  returns ".pi/worktrees"
```

---

## 4. resolvePostCreateHooks

### SHALL-4.1
`resolvePostCreateHooks(remoteUrl, config)` SHALL return the `postCreateHooks` array of the first entry in `config.repos` whose `repoGlob` matches `remoteUrl`.

### SHALL-4.2
`resolvePostCreateHooks(remoteUrl, config)` SHALL return `[]` when no entry matches, when the matching entry has no `postCreateHooks` field, or when `config` is `null`.

### Scenario 4.A — Matching entry with hooks
```
Given: config.repos = [{ repoGlob: "github.com/org/*", worktreeRoot: ".pi/worktrees",
                          postCreateHooks: [{ type: "command", command: "mise install" }] }]
And:   remoteUrl = "github.com/org/my-repo"
Then:  returns [{ type: "command", command: "mise install" }]
```

### Scenario 4.B — Matching entry without hooks
```
Given: config.repos = [{ repoGlob: "github.com/org/*", worktreeRoot: ".pi/worktrees" }]
And:   remoteUrl = "github.com/org/my-repo"
Then:  returns []
```

### Scenario 4.C — No match
```
Given: config.repos = [{ repoGlob: "github.com/org/*", worktreeRoot: ".pi/worktrees",
                          postCreateHooks: [{ type: "command", command: "mise install" }] }]
And:   remoteUrl = "gitlab.com/other/repo"
Then:  returns []
```

### Scenario 4.D — Null config
```
Given: config = null
Then:  returns []
```

---

## 5. createOrTargetWorktree

### SHALL-5.1
`createOrTargetWorktree` SHALL accept a `worktreeRoot` parameter and use it to construct the worktree path instead of the hardcoded `.pi/worktrees`.

### SHALL-5.2
When `worktreeRoot` is a relative path, `createOrTargetWorktree` SHALL resolve it relative to `projectRoot`.

### SHALL-5.3
When `worktreeRoot` is an absolute path, `createOrTargetWorktree` SHALL use it as-is without prepending `projectRoot`.

### Scenario 5.A — Relative root (default behaviour preserved)
```
Given: projectRoot = "/home/user/repos/myrepo"
And:   worktreeRoot = ".pi/worktrees"
And:   branch = "feature/x"
Then:  worktree is created at "/home/user/repos/myrepo/.pi/worktrees/feature/x"
```

### Scenario 5.B — Absolute root from config
```
Given: projectRoot = "/home/user/repos/myrepo"
And:   worktreeRoot = "/fast-ssd/worktrees"
And:   branch = "feature/x"
Then:  worktree is created at "/fast-ssd/worktrees/feature/x"
```

---

## 6. ensureWtpYml

### SHALL-6.1
`ensureWtpYml` SHALL accept a `worktreeRoot` parameter and substitute it as the value of `base_dir` in the generated `.wtp.yml` content.

### SHALL-6.2
The `WTP_YML_CONTENT` template string SHALL NOT hardcode `.pi/worktrees`; the value SHALL be injected at write time.

### SHALL-6.3
`ensureWtpYml` SHALL accept a `postCreateHooks: WtpHook[]` parameter. When non-empty, each hook SHALL be appended to the default hooks (copy-secrets + direnv allow) in the generated YAML.

### SHALL-6.4
When `ensureWtpYml` is called and `.wtp.yml` already exists, it SHALL NOT overwrite it regardless of `postCreateHooks` — the caller must explicitly delete the file or use `/worktree init` to regenerate.

### Scenario 6.A — Default root, no extra hooks
```
Given: worktreeRoot = ".pi/worktrees"
And:   postCreateHooks = []
Then:  generated .wtp.yml contains "base_dir: .pi/worktrees"
And:   contains exactly the two default hooks
```

### Scenario 6.B — Custom root, extra hooks appended
```
Given: worktreeRoot = "/fast-ssd/worktrees"
And:   postCreateHooks = [{ type: "command", command: "mise install" }]
Then:  generated .wtp.yml contains "base_dir: /fast-ssd/worktrees"
And:   contains the two default hooks followed by the mise install command hook
```

---

## 7. /workspace-cleanup

### SHALL-7.1
The `/workspace-cleanup` command SHALL enumerate worktree directories from `resolvedWorktreeRoot` rather than from the hardcoded `.pi/worktrees` path.

### Scenario 7.A — Custom root enumerated
```
Given: resolvedWorktreeRoot = "/fast-ssd/worktrees"
When:  /workspace-cleanup is invoked
Then:  worktree entries are listed from "/fast-ssd/worktrees"
And:   no entries are listed from ".pi/worktrees"
```
