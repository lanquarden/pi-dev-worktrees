/**
 * pi-worktrees — Pi extension for branch workspace isolation.
 *
 * Provides:
 * - Git worktree management via wtp (/worktree command)
 * - Devcontainer targeting per project (/devcontainer command)
 * - Bash tool interception to route commands to the active workspace
 * - Dashboard events for external integrations
 *
 * Commands work in both TUI and dashboard (via useRpcKeeper).
 */

import { execSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { state, loadState, saveState } from "./session.js";
import type { WorktreesState } from "./session.js";
import { applyBashIntercept } from "./bash-intercept.js";
import { registerDashboardUi } from "./dashboard-ui.js";
import { ensureWtpYml, createOrTargetWorktree } from "./worktrees.js";
import {
  findDevcontainerConfig,
  generateOverrideJson,
  probeContainer,
  startContainer,
  stopContainer,
  clearStartupLog,
  tailContainerLog,
  containerLogPath,
  readStartupOutcome,
} from "./devcontainer.js";
import {
  emitWorkspaceCreated,
  emitWorkspaceSwitched,
  emitWorkspaceOff,
  emitWorkspaceRemoved,
  emitDevcontainerStarting,
  emitDevcontainerReady,
  emitDevcontainerStopped,
  emitStateUpdate,
} from "./dashboard-events.js";

// Module-level project root — resolved once in session_start
let projectRoot = "";

// ──────────────────────────────────────────────
// Pure helpers
// ──────────────────────────────────────────────

function isWtpAvailable(): boolean {
  try {
    execSync("wtp --version", { stdio: "ignore", timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

function resolveProjectRoot(): string {
  try {
    return execSync("git rev-parse --show-toplevel", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function buildStatusString(s: WorktreesState): string {
  const parts: string[] = ["pi-worktrees"];
  if (s.worktree) parts.push(`branch:${s.worktree.branch}`);
  if (s.devcontainer?.enabled)
    parts.push(s.devcontainer.starting ? "container:starting" : "container:on");
  return parts.join(" | ");
}

function shellEscapeArg(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function enumerateWorktreeDirs(
  dir: string,
  worktreesRoot: string,
): Array<{ branch: string; path: string }> {
  const results: Array<{ branch: string; path: string }> = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
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

// ──────────────────────────────────────────────
// Core business logic — used by both commands and tools
// ──────────────────────────────────────────────

interface ActionResult {
  ok: boolean;
  message: string;
}

function worktreeStatus(): ActionResult {
  if (!projectRoot) return { ok: false, message: "Not in a git repository" };
  if (state.worktree)
    return { ok: true, message: `Worktree active: ${state.worktree.path} (branch: ${state.worktree.branch})` };
  return { ok: true, message: "No worktree active — commands run in project root" };
}

function worktreeOff(pi: ExtensionAPI): ActionResult {
  if (!projectRoot) return { ok: false, message: "Not in a git repository" };
  state.worktree = undefined;
  saveState(pi, state);
  emitWorkspaceOff(pi, projectRoot);
  emitStateUpdate(pi, state);
  return { ok: true, message: "Worktree mode off — commands run in project root" };
}

function worktreeSet(branch: string, pi: ExtensionAPI): ActionResult {
  if (!projectRoot) return { ok: false, message: "Not in a git repository" };
  if (!isWtpAvailable()) return { ok: false, message: "wtp not found. Install wtp to use worktree features." };

  // Guard: prevent from being run inside a worktree
  try {
    const wtList = execSync("git worktree list --porcelain", { cwd: projectRoot, encoding: "utf8" });
    const mainWorktree = wtList.split("\n").find(l => l.startsWith("worktree "))?.replace("worktree ", "").trim();
    if (mainWorktree && projectRoot !== mainWorktree)
      return { ok: false, message: "Run from the main worktree, not from a worktree" };
  } catch { /* ignore */ }

  try {
    const generated = ensureWtpYml(projectRoot);
    if (generated) {
      // non-fatal notice — caller can surface this
    }
  } catch (err) {
    return { ok: false, message: `Failed to write .wtp.yml: ${String(err)}` };
  }

  const existingPath = join(projectRoot, ".pi", "worktrees", branch);
  const isNew = !existsSync(existingPath);

  let worktreePath: string;
  try {
    worktreePath = createOrTargetWorktree(branch, projectRoot);
  } catch (err) {
    return { ok: false, message: `Failed to create worktree: ${String(err)}` };
  }

  const relPath = relative(projectRoot, worktreePath);
  state.worktree = { branch, path: worktreePath };
  saveState(pi, state);

  if (isNew) emitWorkspaceCreated(pi, branch, worktreePath, projectRoot);
  else emitWorkspaceSwitched(pi, branch, worktreePath, projectRoot);
  emitStateUpdate(pi, state);

  return { ok: true, message: `Worktree active: ${relPath}/ — bash runs there` };
}

function devcontainerStatus(): ActionResult {
  if (!projectRoot) return { ok: false, message: "Not in a git repository" };
  if (state.devcontainer?.enabled) {
    const status = state.devcontainer.starting ? "starting…" : "running";
    return { ok: true, message: `Devcontainer ${status} at ${state.devcontainer.workspace}` };
  }
  return { ok: true, message: "Devcontainer targeting is off" };
}

function devcontainerOff(pi: ExtensionAPI): ActionResult {
  if (!projectRoot) return { ok: false, message: "Not in a git repository" };
  const workspace = state.devcontainer?.workspace ?? projectRoot;

  // Stop the actual Docker container so the next /devcontainer on starts fresh
  // with the current override config. Clear the startup log so stale
  // outcome:success doesn't short-circuit the next devcontainer up.
  const { stopped, containerId } = stopContainer(projectRoot);
  clearStartupLog(projectRoot);

  if (state.devcontainer) {
    state.devcontainer.enabled = false;
    state.devcontainer.starting = false;
    state.devcontainer.remoteWorkspaceFolder = undefined;
  }
  saveState(pi, state);
  emitDevcontainerStopped(pi, workspace, projectRoot);
  emitStateUpdate(pi, state);

  const stopNote = stopped
    ? ` Container ${containerId ? containerId.slice(0, 12) : ""} stopped.`
    : containerId
    ? ` Could not stop container ${containerId.slice(0, 12)} — stop it manually if needed.`
    : " No container ID found in log — container may still be running.";
  return { ok: true, message: `Devcontainer targeting off.${stopNote}` };
}

function devcontainerOn(pi: ExtensionAPI): ActionResult {
  if (!projectRoot) return { ok: false, message: "Not in a git repository" };

  try {
    execSync("devcontainer --version", { stdio: "ignore", timeout: 5000 });
  } catch {
    return { ok: false, message: "devcontainer CLI not found. Install it to use container features." };
  }

  const configPath = findDevcontainerConfig(projectRoot);
  if (!configPath)
    return { ok: false, message: "No .devcontainer/devcontainer.json or .devcontainer.json found at project root." };

  try {
    // Always regenerate the override on explicit /devcontainer on so it
    // stays in sync with the current devcontainer.json.
    generateOverrideJson(projectRoot, configPath, /* force */ true);
  } catch (err) {
    return { ok: false, message: `Failed to generate devcontainer override: ${String(err)}` };
  }

  // Stop any existing container and clear the stale log before starting fresh.
  // This ensures the override config (just regenerated above) is always applied
  // to a new container — not silently ignored because devcontainer up reused a
  // pre-existing one that was started with a different configuration.
  stopContainer(projectRoot);
  clearStartupLog(projectRoot);

  try {
    // --remove-existing-container forces devcontainer up to remove and recreate
    // rather than reusing a stale container from a previous session.
    startContainer(projectRoot, /* removeExisting */ true);
  } catch (err) {
    return { ok: false, message: `Failed to start container: ${String(err)}` };
  }

  state.devcontainer = { enabled: true, workspace: projectRoot, starting: true, startedAt: Date.now() };
  saveState(pi, state);
  emitDevcontainerStarting(pi, projectRoot, projectRoot);
  emitStateUpdate(pi, state);
  return { ok: true, message: "Container starting… bash commands will queue until it's ready" };
}

function workspacesSnapshot(): string {
  if (!projectRoot) return "Not in a git repository";

  const lines: string[] = ["Worktrees (.pi/worktrees/):"];
  const worktreesRoot = join(projectRoot, ".pi", "worktrees");
  let worktreeEntries: Array<{ branch: string; path: string }> = [];

  if (existsSync(worktreesRoot)) {
    try {
      const wtList = execSync("wtp list --quiet", { cwd: projectRoot, encoding: "utf8" }).trim();
      if (wtList) {
        for (const line of wtList.split("\n")) {
          const wtPath = line.trim();
          if (!wtPath || !wtPath.startsWith(join(projectRoot, ".pi", "worktrees"))) continue;
          worktreeEntries.push({ branch: relative(worktreesRoot, wtPath), path: wtPath });
        }
      }
    } catch {
      worktreeEntries = enumerateWorktreeDirs(worktreesRoot, worktreesRoot);
    }
  }

  if (worktreeEntries.length === 0) {
    lines.push("  (none)");
  } else {
    for (const entry of worktreeEntries) {
      const isCurrent = state.worktree?.path === entry.path;
      const marker = isCurrent ? "●" : "○";
      const suffix = isCurrent ? "  [this session]" : "";
      const relPath = relative(projectRoot, entry.path);
      lines.push(`  ${marker} ${entry.branch.padEnd(20)} ${relPath}/${suffix}`);
    }
  }

  lines.push("");
  lines.push("Devcontainer:");
  if (state.devcontainer?.enabled) {
    const alive = probeContainer(projectRoot);
    if (alive) {
      lines.push("  ● Running at project root");
      lines.push("  Use HOST: prefix to bypass container");
    } else {
      lines.push(state.devcontainer.starting ? "  ◌ Starting… (run /devcontainer logs to check progress)" : "  ✗ Not responding (may have stopped — run /devcontainer logs)");
    }
  } else {
    lines.push("  ○ Off (not targeting container)");
  }

  lines.push("");
  lines.push(`Current session: worktree=${state.worktree?.branch ?? "off"}  devcontainer=${state.devcontainer?.enabled ? "on" : "off"}`);
  return lines.join("\n");
}

// ──────────────────────────────────────────────
// Extension entry point
// ──────────────────────────────────────────────

export default function (pi: ExtensionAPI) {

  // ── session_start ──────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    projectRoot = resolveProjectRoot();
    const restored = loadState(ctx);
    Object.assign(state, restored);

    if (!projectRoot) return;

    try {
      const generated = ensureWtpYml(projectRoot);
      if (generated) ctx.ui.notify("Generated .wtp.yml (base_dir: .pi/worktrees)", "info");
    } catch { /* non-fatal */ }

    ctx.ui.setStatus("pi-worktrees", buildStatusString(state));
    registerDashboardUi(pi, projectRoot);
  });

  // ── before_agent_start ─────────────────────
  pi.on("before_agent_start", async () => {
    if (!state.worktree && !state.devcontainer?.enabled) return;

    const lines = ["## Active Workspace (pi-worktrees)"];
    if (state.worktree) {
      lines.push(`- Branch: \`${state.worktree.branch}\``);
      lines.push(`- Worktree path: \`${state.worktree.path}\``);
      lines.push("- Bash commands run inside this worktree directory");
    }
    if (state.devcontainer?.enabled) {
      const status = state.devcontainer.starting ? "starting…" : "running";
      lines.push(`- Devcontainer: ${status} (project root)`);
      if (state.devcontainer.starting) {
        lines.push("- Bash commands will fail until container is ready — run /devcontainer logs to check startup progress");
      } else {
        lines.push("- Bash commands execute inside the container");
      }
      lines.push("- Prefix a command with `HOST:` to run it on the host instead");
    }

    return {
      message: { customType: "pi-worktrees:context", content: lines.join("\n"), display: false },
    };
  });

  // ── tool_call bash interception ────────────
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash" || !projectRoot) return;

    if (state.devcontainer?.enabled && state.devcontainer.starting) {
      // Fast-path: check if the startup log already says success or error
      // before doing the slower exec probe.
      const { outcome, message: outcomeMsg, remoteWorkspaceFolder } = readStartupOutcome(projectRoot);
      if (outcome === "error") {
        // Container failed to start — turn off targeting so commands run on host
        state.devcontainer.starting = false;
        state.devcontainer.enabled = false;
        saveState(pi, state);
        emitStateUpdate(pi, state);
        ctx.ui.setStatus("pi-worktrees", buildStatusString(state));
        const reason = outcomeMsg ? `\n${outcomeMsg}` : "";
        ctx.ui.notify(
          `Devcontainer startup failed — targeting disabled. Run /devcontainer logs for details.${reason}`,
          "warning",
        );
      } else if (outcome === "success") {
        // devcontainer up completed successfully — trust the log, mark ready.
        state.devcontainer.starting = false;
        if (remoteWorkspaceFolder) {
          state.devcontainer.remoteWorkspaceFolder = remoteWorkspaceFolder;
        }
        saveState(pi, state);
        emitDevcontainerReady(pi, state.devcontainer.workspace, projectRoot);
        emitStateUpdate(pi, state);
        ctx.ui.setStatus("pi-worktrees", buildStatusString(state));
        ctx.ui.notify("Devcontainer is ready", "info");
      } else {
        // No outcome line yet — container still starting; try a direct exec probe
        // as a fallback (handles cases where devcontainer up doesn't write JSON).
        const alive = probeContainer(projectRoot);
        if (alive) {
          state.devcontainer.starting = false;
          saveState(pi, state);
          emitDevcontainerReady(pi, state.devcontainer.workspace, projectRoot);
          emitStateUpdate(pi, state);
          ctx.ui.setStatus("pi-worktrees", buildStatusString(state));
          ctx.ui.notify("Devcontainer is ready", "info");
        }
      }
    }

    const cmd = (event.input as { command: string }).command;
    (event.input as { command: string }).command = await applyBashIntercept(cmd, state, projectRoot);
  });

  // ── Commands (TUI + dashboard via useRpcKeeper) ───────────────────────

  pi.registerCommand("worktree", {
    description: "Manage git worktrees. Usage: /worktree [branch | off]",
    handler: async (args, ctx) => {
      const arg = args?.trim();
      if (!arg) {
        const r = worktreeStatus();
        ctx.ui.notify(r.message, r.ok ? "info" : "warning");
        return;
      }
      if (arg === "off") {
        const r = worktreeOff(pi);
        ctx.ui.setStatus("pi-worktrees", buildStatusString(state));
        ctx.ui.notify(r.message, r.ok ? "info" : "warning");
        return;
      }
      if (!isWtpAvailable()) {
        ctx.ui.notify("wtp not found. Install wtp to use worktree features.", "warning");
        return;
      }
      // Ensure wtp.yml — surface notice here since tools silently skip it
      try {
        const generated = ensureWtpYml(projectRoot);
        if (generated) ctx.ui.notify("Generated .wtp.yml (base_dir: .pi/worktrees)", "info");
      } catch (err) {
        ctx.ui.notify(`Failed to write .wtp.yml: ${String(err)}`, "warning");
      }
      const r = worktreeSet(arg, pi);
      ctx.ui.setStatus("pi-worktrees", buildStatusString(state));
      ctx.ui.notify(r.message, r.ok ? "info" : "warning");
    },
  });

  pi.registerCommand("devcontainer", {
    description: "Manage devcontainer targeting. Usage: /devcontainer [on | off | logs]",
    handler: async (args, ctx) => {
      const arg = args?.trim();
      if (!arg) {
        const r = devcontainerStatus();
        ctx.ui.notify(r.message, "info");
        return;
      }
      if (arg === "off") {
        const r = devcontainerOff(pi);
        ctx.ui.setStatus("pi-worktrees", buildStatusString(state));
        ctx.ui.notify(r.message, r.ok ? "info" : "warning");
        return;
      }
      if (arg === "on") {
        const r = devcontainerOn(pi);
        ctx.ui.setStatus("pi-worktrees", buildStatusString(state));
        ctx.ui.notify(r.message, r.ok ? "info" : "warning");
        return;
      }
      if (arg === "logs") {
        if (!projectRoot) { ctx.ui.notify("Not in a git repository", "warning"); return; }
        const logTail = tailContainerLog(projectRoot, 50);
        if (!logTail) {
          ctx.ui.notify(`No startup log found. Expected at: ${containerLogPath(projectRoot)}`, "info");
        } else {
          ctx.ui.notify(logTail, "info");
        }
        return;
      }
      ctx.ui.notify("Usage: /devcontainer [on | off | logs]", "info");
    },
  });

  pi.registerCommand("workspaces", {
    description: "Show all worktrees and devcontainer status",
    handler: async (_args, ctx) => {
      ctx.ui.notify(workspacesSnapshot(), "info");
    },
  });

  pi.registerCommand("workspace-cleanup", {
    description: "Interactively remove stale worktrees",
    handler: async (_args, ctx) => {
      if (!projectRoot) { ctx.ui.notify("Not in a git repository", "warning"); return; }
      if (!isWtpAvailable()) { ctx.ui.notify("wtp not found. Install wtp to use worktree features.", "warning"); return; }

      const worktreesRoot = join(projectRoot, ".pi", "worktrees");
      if (!existsSync(worktreesRoot)) { ctx.ui.notify("No worktrees directory found (.pi/worktrees/)", "info"); return; }

      const entries = enumerateWorktreeDirs(worktreesRoot, worktreesRoot);
      if (entries.length === 0) { ctx.ui.notify("No worktrees found", "info"); return; }

      const now = Date.now();
      const STALE_MS = 7 * 24 * 60 * 60 * 1000;

      const candidates = entries.map((entry) => {
        let mtime = now;
        let dirty = false;
        let ageStr = "unknown age";
        try {
          const st = statSync(entry.path);
          mtime = st.mtimeMs;
          const ageDays = Math.floor((now - mtime) / (24 * 60 * 60 * 1000));
          ageStr = ageDays === 0 ? "today" : `${ageDays}d ago`;
        } catch { /* ignore */ }
        try {
          dirty = execSync("git status --porcelain", { cwd: entry.path, encoding: "utf8", timeout: 3000 }).trim().length > 0;
        } catch { /* ignore */ }
        const isStale = now - mtime > STALE_MS;
        const label = `${entry.branch}  (${ageStr}${dirty ? ", dirty" : ""}${isStale ? " [STALE]" : ""})`;
        return { ...entry, dirty, isStale, label };
      });

      let removedCount = 0;
      const removedBranches: string[] = [];

      for (const candidate of candidates) {
        const shouldRemove = await ctx.ui.confirm(
          `Remove worktree: ${candidate.branch}?`,
          `${candidate.label}${candidate.dirty ? "\n⚠ Has uncommitted changes" : ""}`,
        );
        if (!shouldRemove) continue;

        if (candidate.dirty) {
          const confirmed = await ctx.ui.confirm(
            `${candidate.branch} has uncommitted changes. Force remove?`,
            "This will discard any uncommitted changes in the worktree.",
          );
          if (!confirmed) { ctx.ui.notify(`Skipped ${candidate.branch}`, "info"); continue; }
        }

        try {
          execSync(`wtp remove ${candidate.dirty ? "--force " : ""}${shellEscapeArg(candidate.branch)}`, {
            cwd: projectRoot, encoding: "utf8",
          });
          emitWorkspaceRemoved(pi, candidate.branch, candidate.path, projectRoot);
          removedBranches.push(candidate.branch);
          removedCount++;
        } catch (err) {
          ctx.ui.notify(`Failed to remove ${candidate.branch}: ${String(err)}`, "warning");
        }
      }

      if (state.worktree && removedBranches.includes(state.worktree.branch)) {
        state.worktree = undefined;
        saveState(pi, state);
        emitStateUpdate(pi, state);
        ctx.ui.setStatus("pi-worktrees", buildStatusString(state));
      }

      ctx.ui.notify(`Removed ${removedCount} worktree(s)`, "info");
    },
  });
}
