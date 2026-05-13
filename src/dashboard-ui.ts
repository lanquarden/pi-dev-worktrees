/**
 * dashboard-ui.ts — pi-agent-dashboard visual feedback for pi-worktrees.
 *
 * Registers two contributions via the pi-dashboard extension-ui-system:
 *
 * 1. `footer-segment` decorator — live chip in the session card header showing
 *    the active worktree branch and/or devcontainer state.
 *
 * 2. `management-modal` for `/workspaces` — table of all worktrees under
 *    `.pi/worktrees/` with a per-row Remove action.
 *
 * Both are driven by the synchronous `ui:list-modules` probe emitted by the
 * bridge. State changes call `invalidateDashboardUi()` which emits `ui:invalidate`
 * so the bridge re-probes immediately.
 *
 * No-dashboard fallback: when no bridge is connected, `ui:list-modules` is never
 * emitted and `ui:invalidate` calls are silently ignored. No errors, no breakage.
 */

import { execSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { state } from "./session.js";
import type { WorktreesState } from "./session.js";
import { saveState } from "./session.js";

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const NAMESPACE = "pi-worktrees";
const FOOTER_ID = "workspace-state";
const MODAL_ID = "worktrees-table";
const MODAL_COMMAND = "/workspaces";
const EXEC_TIMEOUT = 3000;
const BRANCH_MAX_LEN = 20;

// Module-level project root — set by registerDashboardUi
let _projectRoot = "";

// ──────────────────────────────────────────────
// Footer text builder
// ──────────────────────────────────────────────

/**
 * Returns the formatted footer segment text, or null when both worktree and
 * devcontainer are inactive (caller should push `removed: true`).
 */
export function buildFooterText(s: WorktreesState): string | null {
  const parts: string[] = [];

  if (s.worktree?.branch) {
    let branch = s.worktree.branch;
    if (branch.length > BRANCH_MAX_LEN) branch = branch.slice(0, BRANCH_MAX_LEN) + "…";
    parts.push(`⎇ ${branch}`);
  }

  if (s.devcontainer?.enabled) {
    parts.push(s.devcontainer.starting ? "🐳 starting…" : "🐳 on");
  }

  return parts.length > 0 ? parts.join("  ") : null;
}

// ──────────────────────────────────────────────
// Worktree enumeration helpers
// ──────────────────────────────────────────────

function shellEscapeArg(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function enumerateWorktreeDirs(
  dir: string,
  worktreesRoot: string,
): Array<{ branch: string; path: string }> {
  const results: Array<{ branch: string; path: string }> = [];
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return results; }
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    try {
      const st = statSync(fullPath);
      if (!st.isDirectory()) continue;
      if (existsSync(join(fullPath, ".git"))) {
        results.push({ branch: relative(worktreesRoot, fullPath), path: fullPath });
      } else {
        results.push(...enumerateWorktreeDirs(fullPath, worktreesRoot));
      }
    } catch { /* ignore */ }
  }
  return results;
}

function getWorktreeEntries(projectRoot: string): Array<{ branch: string; path: string }> {
  const worktreesRoot = join(projectRoot, ".pi", "worktrees");
  if (!existsSync(worktreesRoot)) return [];

  try {
    const out = execSync("wtp list --quiet", {
      cwd: projectRoot, encoding: "utf8", timeout: EXEC_TIMEOUT,
    }).trim();
    if (out) {
      const entries: Array<{ branch: string; path: string }> = [];
      for (const line of out.split("\n")) {
        const wtPath = line.trim();
        if (!wtPath || !wtPath.startsWith(worktreesRoot)) continue;
        entries.push({ branch: relative(worktreesRoot, wtPath), path: wtPath });
      }
      if (entries.length > 0) return entries;
    }
  } catch { /* fall through to directory enumeration */ }

  return enumerateWorktreeDirs(worktreesRoot, worktreesRoot);
}

function buildWorktreeRows(projectRoot: string): Array<Record<string, unknown>> {
  const entries = getWorktreeEntries(projectRoot);
  const now = Date.now();

  return entries.map((entry) => {
    let age = "unknown";
    let dirty = false;

    try {
      const st = statSync(entry.path);
      const ageDays = Math.floor((now - st.mtimeMs) / (24 * 60 * 60 * 1000));
      age = ageDays === 0 ? "today" : `${ageDays}d ago`;
    } catch { /* ignore */ }

    try {
      dirty = execSync("git status --porcelain", {
        cwd: entry.path, encoding: "utf8", timeout: EXEC_TIMEOUT,
      }).trim().length > 0;
    } catch { /* ignore */ }

    return {
      branch: entry.branch,
      path: relative(projectRoot, entry.path),
      age,
      dirty,
    };
  });
}

// ──────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────

/**
 * Emit `ui:invalidate` so the bridge re-probes and updates the footer segment
 * and workspaces modal. Called from dashboard-events.ts after every state change.
 */
export function invalidateDashboardUi(pi: ExtensionAPI): void {
  try {
    pi.events.emit("ui:invalidate", { id: FOOTER_ID });
  } catch { /* no bridge connected — silent */ }
}

/**
 * Register the `ui:list-modules` listener and the data/action event handlers.
 * Call once from the extension entry point.
 */
export function registerDashboardUi(pi: ExtensionAPI, projectRoot: string): void {
  _projectRoot = projectRoot;

  // ── ui:list-modules probe ──────────────────────────────────────────────
  pi.events.on("ui:list-modules", (probe: { modules: unknown[] }) => {
    // 1. footer-segment
    const footerText = buildFooterText(state);
    if (footerText !== null) {
      probe.modules.push({
        kind: "footer-segment",
        namespace: NAMESPACE,
        id: FOOTER_ID,
        payload: { text: footerText, tooltip: "pi-worktrees workspace state" },
      });
    } else {
      probe.modules.push({
        kind: "footer-segment",
        namespace: NAMESPACE,
        id: FOOTER_ID,
        payload: { text: "" },
        removed: true,
      });
    }

    // 2. management-modal for /workspaces
    probe.modules.push({
      kind: "management-modal",
      id: MODAL_ID,
      command: MODAL_COMMAND,
      title: "Worktrees",
      description: "Git worktrees managed by pi-worktrees under .pi/worktrees/",
      icon: "mdiSourceBranch",
      category: "Workspace",
      view: {
        kind: "table",
        dataEvent: "workspaces:list",
        rowKey: "branch",
        emptyState: "No worktrees found under .pi/worktrees/",
        fields: [
          { key: "branch", label: "Branch",  kind: "text" },
          { key: "path",   label: "Path",    kind: "text" },
          { key: "age",    label: "Age",     kind: "text", width: 90 },
          { key: "dirty",  label: "Dirty",   kind: "boolean", width: 60 },
        ],
        rowActions: [
          {
            id: "remove",
            label: "Remove",
            variant: "danger",
            icon: "mdiDelete",
            event: "workspaces:delete-row",
            confirm: "Remove this worktree? Any uncommitted changes will be lost.",
          },
        ],
        actions: [
          {
            id: "refresh",
            label: "Refresh",
            icon: "mdiRefresh",
            event: "workspaces:list",
          },
        ],
      },
    });
  });

  // ── workspaces:list data handler ───────────────────────────────────────
  pi.events.on("workspaces:list", (data: { items?: unknown[] }) => {
    if (!_projectRoot) { data.items = []; return; }
    data.items = buildWorktreeRows(_projectRoot);
  });

  // ── workspaces:delete-row action handler ───────────────────────────────
  pi.events.on("workspaces:delete-row", (data: Record<string, unknown>) => {
    const branch = typeof data.branch === "string" ? data.branch : "";
    if (!branch || !_projectRoot) return;

    const worktreesRoot = join(_projectRoot, ".pi", "worktrees");
    const worktreePath = join(worktreesRoot, branch);

    if (!existsSync(worktreePath)) {
      console.warn(`[pi-worktrees] delete-row: worktree not found: ${branch}`);
      invalidateDashboardUi(pi);
      return;
    }

    // Probe dirty flag
    let dirty = false;
    try {
      dirty = execSync("git status --porcelain", {
        cwd: worktreePath, encoding: "utf8", timeout: EXEC_TIMEOUT,
      }).trim().length > 0;
    } catch { /* assume clean */ }

    try {
      const forceFlag = dirty ? "--force " : "";
      execSync(`wtp remove ${forceFlag}${shellEscapeArg(branch)}`, {
        cwd: _projectRoot, encoding: "utf8", timeout: 10000,
      });
      // Emit removal event directly (avoid circular import with dashboard-events.ts)
      pi.events.emit("pi-worktrees:workspace-removed", {
        type: "worktree", branch, path: worktreePath, cwd: _projectRoot,
      });

      if (state.worktree?.branch === branch) {
        state.worktree = undefined;
        saveState(pi, state);
        // Inline state update event to avoid circular import with dashboard-events.ts
        pi.events.emit("pi-worktrees:state", state);
      }
    } catch (err) {
      console.error(`[pi-worktrees] delete-row: failed to remove ${branch}:`, err);
    }

    invalidateDashboardUi(pi);
  });
}
