## Context

The extension registers slash commands (`/worktree`, `/workspaces`, `/workspace-cleanup`) and documents LLM-callable tools (`worktree_set`, `devcontainer_control`, `workspaces_status`, `workspace_remove`), but the tools are never registered via `pi.registerTool()`. This gap means the LLM cannot call them autonomously — only the TUI can. Additionally, the three slash commands use an inconsistent naming scheme (mixing `/worktree` singular with `/workspaces` plural and `/workspace-cleanup` compound). The README presents installation buried mid-document and conflates optional features with required setup.

## Goals / Non-Goals

**Goals:**
- Register all four documented tools via `pi.registerTool()` so the LLM can chain setup and task work in a single prompt.
- Rename slash commands to a consistent `workspace*` prefix: `/workspace`, `/workspaces`, `/workspace-remove`.
- Restructure README: installation first, clear pi-extension / dashboard-plugin split, `pi-rtk-optimizer` clearly optional.

**Non-Goals:**
- Changing tool behavior or semantics — this is purely additive registration + renames.
- Introducing new tools beyond the four already documented.
- Overhauling the dashboard plugin itself.

## Decisions

**D1 — `pi.registerTool()` wraps existing command handlers**
Each tool delegates to the same logic already powering its slash command counterpart. No duplicate logic: extract shared functions, then call them from both the slash command handler and the tool handler.
*Alternative: copy-paste logic into tool handlers* — rejected; harder to keep in sync.

**D2 — Slash command rename: `/worktree` → `/workspace`**
Aligns with the `workspace*` family (`/workspaces`, `/workspace-remove`). This is a **breaking change** for any TUI users relying on `/worktree`.
*Alternative: keep `/worktree` as alias* — acceptable but adds noise; users should migrate.

**D3 — `/workspace-cleanup` → `/workspace-remove`**
Shorter, action-oriented, consistent with `workspace_remove` tool name.

**D4 — README split into two H2 sections**
"pi Extension" and "Dashboard Plugin" as top-level sections after a short intro + installation block. Optional content (rtk-optimizer, internals) moves to the end.

## Risks / Trade-offs

- [Breaking rename of `/worktree`] → Document in changelog and README migration note; existing sessions will surface a "command not found" which is obvious.
- [Tool schema mismatch with dashboard expectations] → Keep tool input schemas identical to the existing `registerTool` stubs documented in README to avoid dashboard-side changes.

## Migration Plan

1. Add `pi.registerTool()` registrations alongside existing `pi.registerCommand()` calls.
2. Rename slash commands in the command registration strings and update all internal cross-references.
3. Update README structure; add a one-line migration note for `/worktree` → `/workspace`.
4. Bump package version (patch for tools addition, minor if renaming is considered breaking by semver).

## Open Questions

- Should `/worktree` be kept as a deprecated alias for one release cycle? (Lean: no — small user base, clean break preferred.)
