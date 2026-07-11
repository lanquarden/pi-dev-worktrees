/**
 * pi-dev-worktrees — Pi extension for branch workspace isolation.
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
import { join, relative, resolve, isAbsolute } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type, StringEnum } from "@earendil-works/pi-ai";
import { createLocalBashOperations } from "@earendil-works/pi-coding-agent";

import { state, loadState, saveState } from "./session.js";
import type { WorktreesState } from "./session.js";
import { applyBashIntercept } from "./bash-intercept.js";
import { detectRtkConflicts, probeContainerRtk } from "./rtk-compat.js";
import { registerDashboardUi, setDashboardProjectRoot, invalidateDashboardUi } from "./dashboard-ui.js";
import {
  ensureWtpYml,
  createOrTargetWorktree,
  readWtpYml,
  writeWtpYml,
  listHooks,
  addCommandHook,
  removeHook,
  formatHook,
  listWtpWorktrees,
  shellEscapeArg,
} from "./worktrees.js";
import type { WtpHook } from "./worktrees.js";
import {
  loadPluginConfig,
  areWorktreesEnabled,
  isDevcontainerEnabled,
  resolveWorktreeRoot,
  resolvePostCreateHooks,
} from "./config.js";
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
  findContainerIdByLabel,
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
import {
  bashDispatchByToolCall,
  cleanupBashDispatch,
  registerNativeBashRenderer,
  resetBashRendererState,
  setBashDispatch,
} from "./bash-renderer.js";
import type { BashDispatchMetadata, RtkExecution } from "./bash-renderer.js";
import { excludeGeneratedArtifact } from "./generated-artifacts.js";

// Runtime roots are deliberately distinct.
let sessionCwd = "";
let gitRoot = "";
let devcontainerRoot = "";
let worktreesEnabled = true;
let devcontainersEnabled = true;



// Per-repo config resolved at session_start
let resolvedWorktreeRoot: string = ".pi/worktrees";
let resolvedPostCreateHooks: WtpHook[] = [];


// Keyed by toolCallId. Stores original LLM command (pre-RTK) captured in
// tool_execution_start. Deleted after consuming in tool_call.
const pendingLlmCommands = new Map<string, string>();

// Whether rtk is available in the active devcontainer.
// In-memory only — re-evaluated at each container-ready transition.
let containerRtkAvailable: boolean = false;

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

function resolveGitRoot(cwd: string): string {
  try {
    return execSync("git rev-parse --show-toplevel", {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function buildStatusString(s: WorktreesState): string | undefined {
  if (!s.devcontainer?.enabled) return undefined;
  return s.devcontainer.starting ? "container:starting" : "container:on";
}

function refreshStatus(ctx: Pick<ExtensionContext, "ui" | "hasUI">): void {
  if (ctx.hasUI === false) return;
  ctx.ui.setStatus("pi-dev-worktrees", buildStatusString(state));
}

function disabledWorktreeResult(): ActionResult {
  return { ok: false, message: "Worktrees are externally managed; pi-dev-worktrees worktree actions are disabled by config." };
}

function disabledDevcontainerResult(): ActionResult {
  return { ok: false, message: "Devcontainers are disabled by config." };
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
  hookOutput?: string;
}

function worktreeStatus(): ActionResult {
  if (!gitRoot) return { ok: false, message: "Not in a git repository" };
  if (state.worktree)
    return { ok: true, message: `Worktree active: ${state.worktree.path} (branch: ${state.worktree.branch})` };
  return { ok: true, message: "No worktree active — commands run in project root" };
}

function worktreeOff(pi: ExtensionAPI): ActionResult {
  if (!gitRoot) return { ok: false, message: "Not in a git repository" };
  state.worktree = undefined;
  saveState(pi, state);
  emitWorkspaceOff(pi, gitRoot);
  emitStateUpdate(pi, state);
  return { ok: true, message: "Worktree mode off — commands run in project root" };
}

function worktreeSet(branch: string, pi: ExtensionAPI): ActionResult {
  if (!gitRoot) return { ok: false, message: "Not in a git repository" };
  if (!isWtpAvailable()) return { ok: false, message: "wtp not found. Install wtp to use worktree features." };

  // Guard: prevent from being run inside a worktree
  try {
    const wtList = execSync("git worktree list --porcelain", { cwd: gitRoot, encoding: "utf8" });
    const mainWorktree = wtList.split("\n").find(l => l.startsWith("worktree "))?.replace("worktree ", "").trim();
    if (mainWorktree && gitRoot !== mainWorktree)
      return { ok: false, message: "Run from the main worktree, not from a worktree" };
  } catch { /* ignore */ }

  try {
    ensureWtpYml(gitRoot, resolvedWorktreeRoot, resolvedPostCreateHooks);
  } catch (err) {
    return { ok: false, message: `Failed to write .wtp.yml: ${String(err)}` };
  }

  const resolvedRoot = resolve(gitRoot, resolvedWorktreeRoot);
  const existingPath = join(resolvedRoot, branch);
  const isNew = !existsSync(existingPath);

  let worktreePath: string;
  let hookOutput = "";
  try {
    const result = createOrTargetWorktree(branch, gitRoot, resolvedWorktreeRoot);
    worktreePath = result.path;
    hookOutput = result.hookOutput;
  } catch (err) {
    return { ok: false, message: `Failed to create worktree: ${String(err)}` };
  }

  const relPath = relative(gitRoot, worktreePath);
  state.worktree = { branch, path: worktreePath };
  saveState(pi, state);

  if (isNew) emitWorkspaceCreated(pi, branch, worktreePath, gitRoot);
  else emitWorkspaceSwitched(pi, branch, worktreePath, gitRoot);
  emitStateUpdate(pi, state);

  return { ok: true, message: `Worktree active: ${relPath}/ — bash runs there`, hookOutput };
}

/** Mark the devcontainer as ready and refresh all feedback. */
function transitionContainerToReady(
  pi: ExtensionAPI,
  ctx: Pick<ExtensionContext, "ui" | "hasUI">,
): void {
  if (!state.devcontainer) return;
  state.devcontainer.starting = false;
  const outcome = readStartupOutcome(devcontainerRoot);
  if (outcome.remoteWorkspaceFolder) state.devcontainer.remoteWorkspaceFolder = outcome.remoteWorkspaceFolder;
  if (outcome.containerId) state.devcontainer.containerId = outcome.containerId;
  saveState(pi, state);
  emitDevcontainerReady(pi, state.devcontainer.workspace, sessionCwd);
  emitStateUpdate(pi, state);
  refreshStatus(ctx);
  const idNote = state.devcontainer.containerId ? ` — ${state.devcontainer.containerId.slice(0, 12)}` : "";
  if (ctx.hasUI !== false) ctx.ui.notify(`Devcontainer ready${idNote}`, "info");
  if (pi.getCommands().some((c) => c.name === "rtk")) {
    probeContainerRtk(devcontainerRoot, outcome.containerId).then((available) => {
      containerRtkAvailable = available;
    });
  }
}

function devcontainerStatus(): ActionResult {
  if (!devcontainersEnabled) return disabledDevcontainerResult();
  if (!devcontainerRoot) return { ok: false, message: "No devcontainer workspace is available" };
  if (state.devcontainer?.enabled) {
    const status = state.devcontainer.starting ? "starting…" : "running";
    const id = state.devcontainer.containerId ? ` (id: ${state.devcontainer.containerId.slice(0, 12)})` : "";
    return { ok: true, message: `Devcontainer ${status} at ${state.devcontainer.workspace}${id}` };
  }
  return { ok: true, message: "Devcontainer targeting is off" };
}

function devcontainerOff(pi: ExtensionAPI): ActionResult {
  if (!devcontainersEnabled) return disabledDevcontainerResult();
  if (!devcontainerRoot) return { ok: false, message: "No devcontainer workspace is available" };
  const workspace = state.devcontainer?.workspace ?? devcontainerRoot;
  if (state.devcontainer) {
    state.devcontainer.enabled = false;
    state.devcontainer.starting = false;
  }
  saveState(pi, state);
  emitDevcontainerStopped(pi, workspace, sessionCwd);
  emitStateUpdate(pi, state);
  const idNote = state.devcontainer?.containerId
    ? ` Container ${state.devcontainer.containerId.slice(0, 12)} remains running.`
    : " Container remains running.";
  return { ok: true, message: `Devcontainer targeting off.${idNote} Use /devcontainer stop to stop it.` };
}

function ensureDevcontainerCli(): ActionResult | null {
  try {
    execSync("devcontainer --version", { stdio: "ignore", timeout: 5000 });
    return null;
  } catch {
    return { ok: false, message: "devcontainer CLI not found. Install it to use container features." };
  }
}

function devcontainerRebuild(pi: ExtensionAPI): ActionResult {
  if (!devcontainersEnabled) return disabledDevcontainerResult();
  if (!devcontainerRoot) return { ok: false, message: "No devcontainer workspace is available" };
  const cliError = ensureDevcontainerCli();
  if (cliError) return cliError;
  const configPath = findDevcontainerConfig(devcontainerRoot);
  if (!configPath) return { ok: false, message: "No .devcontainer/devcontainer.json or .devcontainer.json found at the devcontainer workspace root." };
  try {
    generateOverrideJson(devcontainerRoot, configPath, true, gitRoot || undefined);
    stopContainer(devcontainerRoot);
    clearStartupLog(devcontainerRoot);
    startContainer(devcontainerRoot, true, true, gitRoot || undefined);
  } catch (err) {
    return { ok: false, message: `Failed to start container: ${String(err)}` };
  }
  state.devcontainer = { enabled: true, workspace: devcontainerRoot, starting: true, startedAt: Date.now() };
  saveState(pi, state);
  emitDevcontainerStarting(pi, devcontainerRoot, sessionCwd);
  emitStateUpdate(pi, state);
  return { ok: true, message: "Devcontainer rebuild started — full image rebuild in progress (this takes longer than a normal start)" };
}

function devcontainerOn(pi: ExtensionAPI): ActionResult {
  if (!devcontainersEnabled) return disabledDevcontainerResult();
  if (!devcontainerRoot) return { ok: false, message: "No devcontainer workspace is available" };
  const cliError = ensureDevcontainerCli();
  if (cliError) return cliError;
  const configPath = findDevcontainerConfig(devcontainerRoot);
  if (!configPath) return { ok: false, message: "No .devcontainer/devcontainer.json or .devcontainer.json found at the devcontainer workspace root." };
  try {
    generateOverrideJson(devcontainerRoot, configPath, true, gitRoot || undefined);
  } catch (err) {
    return { ok: false, message: `Failed to generate devcontainer override: ${String(err)}` };
  }
  if (probeContainer(devcontainerRoot)) {
    const { containerId: logId, remoteWorkspaceFolder } = readStartupOutcome(devcontainerRoot);
    const resolvedId = logId ?? findContainerIdByLabel(devcontainerRoot) ?? state.devcontainer?.containerId;
    state.devcontainer = {
      enabled: true,
      workspace: devcontainerRoot,
      starting: false,
      remoteWorkspaceFolder: remoteWorkspaceFolder ?? state.devcontainer?.remoteWorkspaceFolder,
      containerId: resolvedId,
    };
    saveState(pi, state);
    emitDevcontainerReady(pi, devcontainerRoot, sessionCwd);
    emitStateUpdate(pi, state);
    const idMsg = resolvedId ? ` (container ${resolvedId.slice(0, 12)})` : " (id unknown)";
    return { ok: true, message: `Devcontainer targeting on — reusing running container${idMsg}` };
  }
  stopContainer(devcontainerRoot);
  clearStartupLog(devcontainerRoot);
  try {
    startContainer(devcontainerRoot, true, false, gitRoot || undefined);
  } catch (err) {
    return { ok: false, message: `Failed to start container: ${String(err)}` };
  }
  state.devcontainer = { enabled: true, workspace: devcontainerRoot, starting: true, startedAt: Date.now() };
  saveState(pi, state);
  emitDevcontainerStarting(pi, devcontainerRoot, sessionCwd);
  emitStateUpdate(pi, state);
  return { ok: true, message: "Container starting… bash commands will queue until it's ready" };
}

function doDevcontainerStop(pi: ExtensionAPI): ActionResult {
  if (!devcontainersEnabled) return disabledDevcontainerResult();
  if (!devcontainerRoot) return { ok: false, message: "No devcontainer workspace is available" };
  const { stopped, containerId, stoppedAllByLabel } = stopContainer(devcontainerRoot);
  if (!stopped) return { ok: false, message: `Failed to stop devcontainer${containerId ? `: ${containerId.slice(0, 12)}` : ""}` };
  clearStartupLog(devcontainerRoot);
  const workspace = state.devcontainer?.workspace ?? devcontainerRoot;
  if (state.devcontainer) {
    state.devcontainer.enabled = false;
    state.devcontainer.starting = false;
    state.devcontainer.containerId = undefined;
  }
  saveState(pi, state);
  emitDevcontainerStopped(pi, workspace, sessionCwd);
  emitStateUpdate(pi, state);
  const note = stoppedAllByLabel
    ? "Devcontainer(s) stopped by label"
    : `Devcontainer stopped${containerId ? `: ${containerId.slice(0, 12)}` : ""}`;
  return { ok: true, message: note };
}

function reconcileRestoredDevcontainer(
  pi: ExtensionAPI,
  ctx: Pick<ExtensionContext, "ui" | "hasUI">,
): void {
  const restored = state.devcontainer;
  if (!restored?.enabled || !devcontainerRoot) return;

  const outcome = readStartupOutcome(devcontainerRoot);
  const remoteWorkspace = restored.workspace === devcontainerRoot
    ? restored.remoteWorkspaceFolder ?? outcome.remoteWorkspaceFolder
    : outcome.remoteWorkspaceFolder;
  const differentWorkspace = restored.workspace !== devcontainerRoot;
  const mismatchedMount = Boolean(remoteWorkspace && remoteWorkspace !== devcontainerRoot);

  if (!differentWorkspace && !mismatchedMount) {
    if (restored.starting) return;
    if (probeContainer(devcontainerRoot)) {
      transitionContainerToReady(pi, ctx);
      return;
    }
    // Restored targeting claims readiness but the current-root container is gone.
    // Re-enter the normal reconciliation path and recreate only this root.
  }

  const replaceCurrentRoot = mismatchedMount || !differentWorkspace;
  state.devcontainer = {
    enabled: true,
    workspace: devcontainerRoot,
    starting: true,
    startedAt: Date.now(),
  };
  saveState(pi, state);
  refreshStatus(ctx);
  if (ctx.hasUI !== false) {
    ctx.ui.notify("Restarting devcontainer targeting for the current session cwd.", "info");
  }

  const cliError = ensureDevcontainerCli();
  const configPath = findDevcontainerConfig(devcontainerRoot);
  if (cliError || !configPath) {
    state.devcontainer = undefined;
    saveState(pi, state);
    refreshStatus(ctx);
    if (ctx.hasUI !== false) {
      ctx.ui.notify(
        cliError?.message ?? "No .devcontainer/devcontainer.json or .devcontainer.json found at the devcontainer workspace root.",
        "warning",
      );
    }
    return;
  }

  try {
    generateOverrideJson(devcontainerRoot, configPath, true, gitRoot || undefined);
    if (differentWorkspace && !mismatchedMount && probeContainer(devcontainerRoot)) {
      transitionContainerToReady(pi, ctx);
      return;
    }
    if (replaceCurrentRoot) stopContainer(devcontainerRoot);
    clearStartupLog(devcontainerRoot);
    startContainer(devcontainerRoot, replaceCurrentRoot, false, gitRoot || undefined);
    emitDevcontainerStarting(pi, devcontainerRoot, sessionCwd);
    emitStateUpdate(pi, state);
  } catch (err) {
    state.devcontainer = undefined;
    saveState(pi, state);
    refreshStatus(ctx);
    if (ctx.hasUI !== false) ctx.ui.notify(`Failed to start container: ${String(err)}`, "warning");
  }
}

function workspacesSnapshot(): string {
  if (!gitRoot) return "Not in a git repository";

  const lines: string[] = [`Worktrees (${resolvedWorktreeRoot}/):`,];
  const worktreesRoot = resolve(gitRoot, resolvedWorktreeRoot);
  let worktreeEntries: Array<{ branch: string; path: string }> = [];

  if (existsSync(worktreesRoot)) {
    try {
      worktreeEntries = listWtpWorktrees(gitRoot, worktreesRoot);
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
      const relPath = relative(gitRoot, entry.path);
      let head = "";
      try {
        head = execSync("git rev-parse --abbrev-ref HEAD", { cwd: entry.path, encoding: "utf8", timeout: 3000 }).trim();
      } catch { /* ignore */ }
      const mismatch = head && head !== entry.branch ? `  [HEAD:${head}]` : "";
      lines.push(`  ${marker} ${entry.branch.padEnd(20)} ${relPath}/${suffix}${mismatch}`);
    }
  }

  lines.push("");
  lines.push("Devcontainer:");
  if (state.devcontainer?.enabled) {
    const alive = probeContainer(gitRoot);
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
// Worktree remove helper (shared by command + tool)
// ──────────────────────────────────────────────

function doWorktreeRemove(branch: string, pi: ExtensionAPI): ActionResult {
  if (!gitRoot) return { ok: false, message: "Not in a git repository" };
  if (!isWtpAvailable()) return { ok: false, message: "wtp not found. Install wtp to use worktree features." };

  const resolvedRoot = resolve(gitRoot, resolvedWorktreeRoot);
  const worktreePath = join(resolvedRoot, branch);

  let dirty = false;
  try {
    dirty = execSync("git status --porcelain", { cwd: worktreePath, encoding: "utf8", timeout: 3000 }).trim().length > 0;
  } catch { /* non-existent path — wtp remove will handle the error */ }

  try {
    execSync(`wtp remove ${dirty ? "--force " : ""}${shellEscapeArg(branch)}`, {
      cwd: gitRoot, encoding: "utf8",
    });
  } catch (err) {
    return { ok: false, message: `Failed to remove worktree '${branch}': ${String(err)}` };
  }

  emitWorkspaceRemoved(pi, branch, worktreePath, gitRoot);

  if (state.worktree?.branch === branch) {
    state.worktree = undefined;
    saveState(pi, state);
    emitStateUpdate(pi, state);
  }

  try {
    execSync("git worktree prune", { cwd: gitRoot, encoding: "utf8" });
  } catch { /* best-effort */ }

  return { ok: true, message: `Removed worktree '${branch}'` };
}

// ──────────────────────────────────────────────
// Hook management helpers
// ──────────────────────────────────────────────

function worktreeHooksShow(gitRoot: string): ActionResult {
  const config = readWtpYml(gitRoot);
  if (!config) {
    return { ok: true, message: "No .wtp.yml found. Run /worktree init or /worktree hooks add <cmd> to create one." };
  }
  const hooks = listHooks(config);
  if (hooks.length === 0) {
    return { ok: true, message: "No post_create hooks defined. Use /worktree hooks add <cmd> to add one." };
  }
  const lines = ["post_create hooks (.wtp.yml):"];
  hooks.forEach((hook, i) => {
    lines.push(`  [${i + 1}] ${formatHook(hook)}`);
  });
  lines.push("");
  lines.push("Use /worktree hooks add <command> to append a command hook.");
  lines.push("Use /worktree hooks remove <n> to remove a hook by index.");
  return { ok: true, message: lines.join("\n") };
}

function worktreeHooksAdd(command: string, gitRoot: string): ActionResult {
  if (!command.trim()) {
    return { ok: true, message: "Usage: /worktree hooks add <command>" };
  }
  let config = readWtpYml(gitRoot);
  if (!config) {
    // Create default config structure
    config = {
      version: "1.0",
      defaults: { base_dir: resolvedWorktreeRoot },
      hooks: { post_create: [] },
    };
  }
  const updatedConfig = addCommandHook(config, command.trim());
  writeWtpYml(gitRoot, updatedConfig);
  const n = listHooks(updatedConfig).length;
  return { ok: true, message: `Added hook [${n}]: ${command.trim()}` };
}

async function worktreeHooksRemove(
  indexStr: string,
  gitRoot: string,
  ctx: Parameters<Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]>[1],
): Promise<void> {
  const config = readWtpYml(gitRoot);
  if (!config) {
    ctx.ui.notify("No hooks to remove.", "info");
    return;
  }
  const hooks = listHooks(config);
  if (hooks.length === 0) {
    ctx.ui.notify("No hooks to remove.", "info");
    return;
  }
  const index = parseInt(indexStr, 10);
  if (isNaN(index) || index < 1 || index > hooks.length) {
    ctx.ui.notify("Invalid index. Run /worktree hooks to see hook numbers.", "warning");
    return;
  }
  const hookDesc = formatHook(hooks[index - 1]);
  const confirmed = await ctx.ui.confirm(
    `Remove hook [${index}]: ${hookDesc}?`,
    "This will remove the hook from .wtp.yml.",
  );
  if (!confirmed) {
    ctx.ui.notify("Cancelled", "info");
    return;
  }
  const updatedConfig = removeHook(config, index);
  writeWtpYml(gitRoot, updatedConfig);
  ctx.ui.notify(`Removed hook [${index}]: ${hookDesc}`, "info");
}

async function worktreeHooksClear(
  gitRoot: string,
  ctx: Parameters<Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]>[1],
): Promise<void> {
  const config = readWtpYml(gitRoot);
  if (!config) {
    ctx.ui.notify("No post_create hooks to clear.", "info");
    return;
  }
  const hooks = listHooks(config);
  if (hooks.length === 0) {
    ctx.ui.notify("No post_create hooks to clear.", "info");
    return;
  }
  const confirmed = await ctx.ui.confirm(
    "Clear all post_create hooks?",
    `This will remove all ${hooks.length} hook(s) from .wtp.yml.`,
  );
  if (!confirmed) {
    ctx.ui.notify("Cancelled", "info");
    return;
  }
  const updatedConfig = { ...config, hooks: { ...config.hooks, post_create: [] } };
  writeWtpYml(gitRoot, updatedConfig);
  ctx.ui.notify("Cleared all post_create hooks.", "info");
}

async function worktreeInit(
  gitRoot: string,
  ctx: Parameters<Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]>[1],
): Promise<void> {
  const existingConfig = readWtpYml(gitRoot);
  if (existingConfig) {
    const confirmed = await ctx.ui.confirm(
      "Regenerate .wtp.yml?",
      "This will overwrite existing hooks and settings.",
    );
    if (!confirmed) {
      ctx.ui.notify("Aborted — .wtp.yml unchanged.", "info");
      return;
    }
  }

  const commandsInput = await ctx.ui.input(
    "Setup commands (comma-separated, blank to skip):",
    "npm install, mise install",
  );
  const copyInput = await ctx.ui.input(
    "Files to copy from main worktree (comma-separated, blank to skip):",
    ".env, .secrets",
  );

  const commandHooks: Array<{ type: string; command: string }> = commandsInput
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((cmd) => ({ type: "command", command: cmd }));

  const copyHooks: Array<{ type: string; from: string; to: string }> = copyInput
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((f) => ({ type: "copy", from: f, to: f }));

  const allHooks = [...commandHooks, ...copyHooks];

  if (allHooks.length === 0) {
    // Write default template using ensureWtpYml then overwrite if needed
    const { writeFileSync } = await import("node:fs");
    const { join: pathJoin } = await import("node:path");
    const WTP_DEFAULT = `version: "1.0"
defaults:
  base_dir: ${JSON.stringify(resolvedWorktreeRoot)}

hooks:
  post_create:
    # Copy gitignored secrets from the main repo into the new worktree
    - type: command
      command: |
        MAIN=$(git worktree list --porcelain | head -1 | awk '{print $2}')
        for f in $(git -C "$MAIN" ls-files --others --ignored --exclude-standard 2>/dev/null | grep -v '/'); do
          [ -f "$MAIN/$f" ] && cp "$MAIN/$f" . && echo "Copied $f"
        done

    # Allow direnv if .envrc is present
    - type: command
      command: "[ -f .envrc ] && direnv allow || true"
`;
    const generatedPath = pathJoin(gitRoot, ".wtp.yml");
    writeFileSync(generatedPath, WTP_DEFAULT, "utf8");
    excludeGeneratedArtifact(gitRoot, generatedPath);
    ctx.ui.notify("Written .wtp.yml with default hooks.", "info");
    return;
  }

  const config: import("./worktrees.js").WtpConfig = {
    version: "1.0",
    defaults: { base_dir: resolvedWorktreeRoot },
    hooks: { post_create: allHooks as import("./worktrees.js").WtpHook[] },
  };
  writeWtpYml(gitRoot, config);
  ctx.ui.notify(`Written .wtp.yml with ${allHooks.length} post_create hook(s).`, "info");
}

// ──────────────────────────────────────────────
// Extension entry point
// ──────────────────────────────────────────────

export default function (pi: ExtensionAPI) {

  // Register dashboard UI listeners at init time, NOT inside session_start.
  // The bridge's session_start handler calls refreshUiModules (which emits
  // ui:list-modules) BEFORE pi-dev-worktrees' session_start runs. Registering
  // here ensures the ui:list-modules listener is in place before the bridge
  // fires it. gitRoot is set separately via setDashboardProjectRoot().
  registerDashboardUi(pi, areWorktreesEnabled(loadPluginConfig()));

  // ── session_start ──────────────────────────
  pi.on("session_start", async (_event, ctx) => {
    sessionCwd = ctx.cwd;
    const pluginConfig = loadPluginConfig();
    worktreesEnabled = areWorktreesEnabled(pluginConfig);
    devcontainersEnabled = isDevcontainerEnabled(pluginConfig);
    gitRoot = resolveGitRoot(sessionCwd);
    devcontainerRoot = worktreesEnabled ? gitRoot : sessionCwd;
    containerRtkAvailable = false;
    pendingLlmCommands.clear();
    resetBashRendererState();

    const restored = loadState(ctx);
    state.worktree = restored.worktree;
    state.devcontainer = restored.devcontainer;
    let sanitized = false;
    if (!worktreesEnabled && state.worktree) {
      state.worktree = undefined;
      sanitized = true;
    }
    if (!devcontainersEnabled && state.devcontainer) {
      state.devcontainer = undefined;
      sanitized = true;
    }
    if (sanitized) saveState(pi, state);

    const activeTools = (pi as any).getActiveTools?.() as string[] | undefined;
    if (activeTools && (pi as any).setActiveTools) {
      (pi as any).setActiveTools(activeTools.filter((name) =>
        (worktreesEnabled || name !== "worktree") &&
        (devcontainersEnabled || name !== "devcontainer")
      ));
    }

    setDashboardProjectRoot(gitRoot, worktreesEnabled);

    if (worktreesEnabled && gitRoot) {
      let remoteUrl = "";
      try {
        remoteUrl = execSync("git remote get-url origin", { cwd: gitRoot, encoding: "utf8" }).trim();
      } catch { /* no origin remote */ }
      resolvedWorktreeRoot = resolveWorktreeRoot(remoteUrl, pluginConfig);
      resolvedPostCreateHooks = resolvePostCreateHooks(remoteUrl, pluginConfig);
      try {
        const generated = ensureWtpYml(gitRoot, resolvedWorktreeRoot, resolvedPostCreateHooks);
        if (generated && ctx.hasUI !== false) {
          ctx.ui.notify(`Generated .wtp.yml (base_dir: ${resolvedWorktreeRoot})`, "info");
        } else if (!generated) {
          const existingConfig = readWtpYml(gitRoot);
          if (existingConfig?.defaults?.base_dir) resolvedWorktreeRoot = existingConfig.defaults.base_dir;
        }
      } catch { /* non-fatal */ }
    }

    refreshStatus(ctx);
    const rendererInstalled = registerNativeBashRenderer(pi, sessionCwd, ctx);
    if (ctx.mode !== "tui" || rendererInstalled) detectRtkConflicts(pi, ctx);
    if (devcontainersEnabled) reconcileRestoredDevcontainer(pi, ctx);
    invalidateDashboardUi(pi);
  });

  // ── before_agent_start ─────────────────────
  pi.on("before_agent_start", async () => {
    if ((!worktreesEnabled || !state.worktree) && (!devcontainersEnabled || !state.devcontainer?.enabled)) return;

    const lines = ["## Active Workspace (pi-dev-worktrees)"];
    if (worktreesEnabled && state.worktree) {
      lines.push(`- Branch: \`${state.worktree.branch}\``);
      lines.push(`- Worktree path: \`${state.worktree.path}\``);
      lines.push("- Bash commands are run inside this worktree directory on the host");
      lines.push("- File tools (read/write/edit) with relative paths are also routed to the worktree — use absolute paths to target the original project root");
    }
    if (devcontainersEnabled && state.devcontainer?.enabled) {
      const status = state.devcontainer.starting ? "starting…" : "running";
      lines.push(`- Devcontainer: ${status}`);
      if (state.devcontainer.starting) {
        lines.push("- Bash commands will fail until container is ready — run /devcontainer logs to check startup progress");
      } else {
        lines.push("- **All bash commands are automatically executed inside the container**");
        lines.push("- Tool results are prefixed with [container] or [host] so you always know where a command ran");
        lines.push("- To run a single command on the host instead, prefix it with `HOST:` (e.g. `HOST: docker ps`)");
        lines.push("- git/gh commands always run on the host regardless of devcontainer state");
        lines.push("- If you need to temporarily bypass container routing for several commands, use `HOST:` on each one");
      }
    }

    return {
      message: { customType: "pi-dev-worktrees:context", content: lines.join("\n"), display: false },
    };
  });

  // ── tool_execution_start: capture original LLM command (pre-RTK) ────────
  pi.on("tool_execution_start", (event) => {
    if (event.toolName !== "bash") return;
    if (event.toolCallId) {
      pendingLlmCommands.set(event.toolCallId, (event.args as { command?: string })?.command ?? "");
    }
  });

  // ── tool_call: route file tools (read/write/edit) to worktree for relative paths ────────────
  pi.on("tool_call", async (event, _ctx) => {
    if (!worktreesEnabled || !gitRoot) return;
    // Only adjust when a worktree is active
    const base = state.worktree?.path;
    if (!base) return;

    // Route built-in file tools by rewriting relative paths to be under the worktree.
    // Absolute paths are left untouched to allow explicit targeting of project root or elsewhere.
    if (event.toolName === "read" || event.toolName === "write" || event.toolName === "edit") {
      const input = event.input as { path?: string };
      const p = input?.path;
      if (p && !isAbsolute(p)) {
        input.path = join(base, p);
      }
    }
  });

  // ── tool_call bash interception ────────────
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash" || (!gitRoot && !devcontainerRoot)) return;

    if (state.devcontainer?.enabled && state.devcontainer.starting) {
      // Fast-path: check if the startup log already says success or error
      // before doing the slower exec probe.
      const { outcome, message: outcomeMsg } = readStartupOutcome(devcontainerRoot);
      if (outcome === "error") {
        state.devcontainer.starting = false;
        state.devcontainer.enabled = false;
        saveState(pi, state);
        emitStateUpdate(pi, state);
        refreshStatus(ctx);
        const reason = outcomeMsg ? `\n${outcomeMsg}` : "";
        ctx.ui.notify(
          `Devcontainer startup failed — targeting disabled. Run /devcontainer logs for details.${reason}`,
          "warning",
        );
      } else if (outcome === "success") {
        transitionContainerToReady(pi, ctx);
      } else if (probeContainer(devcontainerRoot)) {
        transitionContainerToReady(pi, ctx);
      }
    }

    // Capture post-RTK command at handler entry (RTK already ran before this handler)
    const rtkCommand = (event.input as { command: string }).command;

    // Retrieve original LLM command captured in tool_execution_start
    const llmCommand = pendingLlmCommands.get(event.toolCallId ?? "") ?? rtkCommand;
    pendingLlmCommands.delete(event.toolCallId ?? "");

    const rtkRewritten = rtkCommand !== llmCommand;

    // If the command was rewritten by RTK but rtk is not available in the
    // container, fall back to the original LLM command so the container
    // doesn't fail with "rtk: command not found".
    const willRouteToContainer =
      state.devcontainer?.enabled && !state.devcontainer?.starting;
    const commandToIntercept =
      rtkRewritten && willRouteToContainer && !containerRtkAvailable
        ? llmCommand
        : rtkCommand;

    const result = await applyBashIntercept(commandToIntercept, state, devcontainerRoot || gitRoot);
    (event.input as { command: string }).command = result.command;

    const rtk: RtkExecution = !rtkRewritten
      ? "none"
      : commandToIntercept === llmCommand ? "fallback" : "applied";
    const dispatchPayload: BashDispatchMetadata & { toolCallId?: string } = {
      toolCallId: event.toolCallId,
      llmCommand,
      rtkRewritten,
      rtkCommand: rtkRewritten ? rtkCommand : undefined,
      rtk,
      routing: result.routing,
      containerId: result.containerId,
      cwd: worktreesEnabled ? result.cwd : undefined,
      hasDevcontainer: state.devcontainer !== undefined,
      containerTargetingActive: Boolean(state.devcontainer?.enabled),
      managedWorktree: worktreesEnabled && Boolean(state.worktree),
    };
    setBashDispatch(event.toolCallId, dispatchPayload);
    (pi as any).events?.emit("pi-dev-worktrees:bash-dispatch", dispatchPayload);
  });

  // ── tool_result: prefix output with routing context ─────────────────
  // Gives the LLM a clear, consistent signal about where each command ran.
  // Dashboard renders the original LLM tool-call (shows "uv lock --check"),
  // so the prefix in the result is the main grounding signal for both TUI
  // and dashboard sessions.
  pi.on("tool_result", async (event) => {
    if (event.toolName !== "bash") return;
    const metadata = bashDispatchByToolCall.get(event.toolCallId ?? "");
    if (!metadata) return;
    const { routing, hasDevcontainer } = metadata;
    cleanupBashDispatch(event.toolCallId);
    if (routing === "error") return; // error text is self-explanatory

    const prefix = routing === "container" ? "[container]\n" : "[host]\n";
    // Only prefix [host] when a devcontainer was configured for this call.
    if (routing === "host" && !hasDevcontainer) return;
    const updated = event.content.map((block) => {
      if (block.type !== "text") return block;
      return { ...block, text: prefix + block.text };
    });
    return { content: updated };
  });

  pi.on("tool_execution_end", (event) => {
    if (event.toolName !== "bash") return;
    pendingLlmCommands.delete(event.toolCallId ?? "");
    cleanupBashDispatch(event.toolCallId);
  });

  // ── user_bash: apply worktree / container routing to ! commands ─────────
  pi.on("user_bash", async (event) => {
    // !! commands (excludeFromContext=true) are intentionally not intercepted —
    // same policy as pi-rtk-optimizer. User opted out of context inclusion;
    // routing would be surprising.
    if (event.excludeFromContext) return undefined;
    if (!gitRoot && !devcontainerRoot) return undefined;

    const result = await applyBashIntercept(event.command, state, devcontainerRoot || gitRoot);
    // If routing is "error" the command is already replaced with an error
    // message command by applyBashIntercept; run it as-is on the host.
    const localOps = createLocalBashOperations();
    return {
      operations: {
        exec: (cmd: string, cwd: string, opts: Parameters<typeof localOps.exec>[2]) =>
          localOps.exec(result.command, cwd, opts),
      },
    };
  });

  // ── Tools (LLM-callable) ────────────────────────────────────────

  pi.registerTool({
    name: "worktree",
    label: "Worktree",
    description: "Manage git worktrees. Use action='set' to create/switch branch (branch required), 'remove' to delete (branch required), 'off' to deactivate, 'prune' to clear stale metadata, 'status' to list active worktrees.",
    promptSnippet: "Create/switch/remove worktrees and check worktree status",
    parameters: Type.Object({
      action: StringEnum(["set", "off", "prune", "status", "remove"] as const, {
        description: "Operation: 'set' or 'remove' require branch; 'off', 'prune', 'status' do not",
      }),
      branch: Type.Optional(Type.String({ description: "Branch name — required for 'set' and 'remove'" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { action, branch } = params;
      if (!worktreesEnabled) {
        const result = disabledWorktreeResult();
        return { content: [{ type: "text", text: result.message }], details: { ok: false } };
      }

      // Runtime enforcement: branch required for set/remove
      if ((action === "set" || action === "remove") && !branch) {
        return {
          content: [{ type: "text", text: `Error: 'branch' is required when action is '${action}'` }],
          details: { ok: false },
        };
      }

      let result: ActionResult;

      switch (action) {
        case "set": {
          result = worktreeSet(branch!, pi);
          if (result.ok) (pi as any).ui?.setStatus?.("pi-dev-worktrees", buildStatusString(state));
          break;
        }
        case "off": {
          result = worktreeOff(pi);
          break;
        }
        case "prune": {
          if (!gitRoot) {
            result = { ok: false, message: "Not in a git repository" };
          } else {
            try {
              const output = execSync("git worktree prune", { cwd: gitRoot, encoding: "utf8" }).trim();
              result = { ok: true, message: output || "No stale worktree metadata found." };
            } catch (e) {
              result = { ok: false, message: "git worktree prune failed: " + (e instanceof Error ? e.message : String(e)) };
            }
          }
          break;
        }
        case "status": {
          result = { ok: true, message: workspacesSnapshot() };
          break;
        }
        case "remove": {
          result = doWorktreeRemove(branch!, pi);
          if (result.ok) (pi as any).ui?.setStatus?.("pi-dev-worktrees", buildStatusString(state));
          break;
        }
      }

      return {
        content: [{ type: "text", text: result!.message + (result!.hookOutput ? "\n" + result!.hookOutput : "") }],
        details: { ok: result!.ok },
      };
    },
  });

  pi.registerTool({
    name: "devcontainer",
    label: "Devcontainer",
    description: "Manage devcontainer targeting. Use action='on' to start, 'off' to disable targeting, 'stop' to stop the container, 'rebuild' to force full image rebuild, 'logs' to tail startup output.",
    promptSnippet: "Start, stop, rebuild or check logs for the devcontainer",
    parameters: Type.Object({
      action: StringEnum(["on", "off", "stop", "rebuild", "logs"] as const, {
        description: "Operation to perform on the devcontainer",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { action } = params;
      if (!devcontainersEnabled) {
        const result = disabledDevcontainerResult();
        return { content: [{ type: "text", text: result.message }], details: { ok: false } };
      }
      let result: ActionResult;

      switch (action) {
        case "on":      result = devcontainerOn(pi); break;
        case "off":     result = devcontainerOff(pi); break;
        case "stop": {
          result = doDevcontainerStop(pi);
          break;
        }
        case "rebuild": result = devcontainerRebuild(pi); break;
        case "logs": {
          if (!devcontainerRoot) {
            result = { ok: false, message: "No devcontainer workspace is available" };
          } else {
            const logTail = tailContainerLog(devcontainerRoot, 50);
            result = { ok: true, message: logTail || `No startup log found. Expected at: ${containerLogPath(devcontainerRoot)}` };
          }
          break;
        }
      }

      refreshStatus(ctx);
      return {
        content: [{ type: "text", text: result!.message }],
        details: { ok: result!.ok },
      };
    },
  });

  // ── Commands (TUI + dashboard via useRpcKeeper) ───────────────────────

  pi.registerCommand("worktree", {
    description: "Manage git worktrees. Usage: /worktree [set] <branch> | off | prune | status | remove <branch> | init | hooks ...",
    handler: async (args, ctx) => {
      if (!worktreesEnabled) {
        const r = disabledWorktreeResult();
        ctx.ui.notify(r.message, "info");
        return;
      }
      const arg = args?.trim();
      if (!arg) {
        const r = worktreeStatus();
        ctx.ui.notify(r.message, r.ok ? "info" : "warning");
        return;
      }
      if (arg === "off") {
        const r = worktreeOff(pi);
        ctx.ui.setStatus("pi-dev-worktrees", buildStatusString(state));
        ctx.ui.notify(r.message, r.ok ? "info" : "warning");
        return;
      }
      if (arg === "init") {
        if (!gitRoot) { ctx.ui.notify("Not in a git repository", "warning"); return; }
        await worktreeInit(gitRoot, ctx);
        return;
      }
      if (arg === "hooks" || arg === "hooks show") {
        if (!gitRoot) { ctx.ui.notify("Not in a git repository", "warning"); return; }
        const r = worktreeHooksShow(gitRoot);
        ctx.ui.notify(r.message, r.ok ? "info" : "warning");
        return;
      }
      if (arg.startsWith("hooks add ")) {
        if (!gitRoot) { ctx.ui.notify("Not in a git repository", "warning"); return; }
        const cmd = arg.slice("hooks add ".length).trim();
        const r = worktreeHooksAdd(cmd, gitRoot);
        ctx.ui.notify(r.message, r.ok ? "info" : "warning");
        return;
      }
      if (arg === "hooks add") {
        ctx.ui.notify("Usage: /worktree hooks add <command>", "info");
        return;
      }
      if (arg.startsWith("hooks remove ")) {
        if (!gitRoot) { ctx.ui.notify("Not in a git repository", "warning"); return; }
        const idxStr = arg.slice("hooks remove ".length).trim();
        await worktreeHooksRemove(idxStr, gitRoot, ctx);
        return;
      }
      if (arg === "hooks clear") {
        if (!gitRoot) { ctx.ui.notify("Not in a git repository", "warning"); return; }
        await worktreeHooksClear(gitRoot, ctx);
        return;
      }
      if (arg === "prune") {
        if (!gitRoot) { ctx.ui.notify("Not in a git repository", "warning"); return; }
        try {
          const output = execSync("git worktree prune", { cwd: gitRoot, encoding: "utf8" }).trim();
          ctx.ui.notify(output || "No stale worktree metadata found.", "info");
        } catch (e) {
          ctx.ui.notify("git worktree prune failed: " + (e instanceof Error ? e.message : String(e)), "warning");
        }
        return;
      }
      if (arg === "status") {
        ctx.ui.notify(workspacesSnapshot(), "info");
        return;
      }
      if (arg === "remove") {
        ctx.ui.notify("Usage: /worktree remove <branch>", "info");
        return;
      }
      if (arg.startsWith("remove ")) {
        const branch = arg.slice("remove ".length).trim();
        if (!branch) { ctx.ui.notify("Usage: /worktree remove <branch>", "info"); return; }
        if (!gitRoot) { ctx.ui.notify("Not in a git repository", "warning"); return; }
        if (!isWtpAvailable()) { ctx.ui.notify("wtp not found. Install wtp to use worktree features.", "warning"); return; }
        const confirmed = await ctx.ui.confirm(
          `Remove worktree '${branch}'?`,
          "Any uncommitted changes in this worktree will be lost.",
        );
        if (!confirmed) { ctx.ui.notify("Cancelled", "info"); return; }
        const r = doWorktreeRemove(branch, pi);
        ctx.ui.setStatus("pi-dev-worktrees", buildStatusString(state));
        ctx.ui.notify(r.message, r.ok ? "info" : "warning");
        return;
      }
      // Strip optional 'set ' prefix — /worktree set feature/auth == /worktree feature/auth
      const branch = arg.startsWith("set ") ? arg.slice("set ".length).trim() : arg;
      if (!isWtpAvailable()) {
        ctx.ui.notify("wtp not found. Install wtp to use worktree features.", "warning");
        return;
      }
      // Ensure wtp.yml — surface notice here since tools silently skip it
      try {
        const generated = ensureWtpYml(gitRoot, resolvedWorktreeRoot, resolvedPostCreateHooks);
        if (generated) ctx.ui.notify(`Generated .wtp.yml (base_dir: ${resolvedWorktreeRoot})`, "info");
      } catch (err) {
        ctx.ui.notify(`Failed to write .wtp.yml: ${String(err)}`, "warning");
      }
      const r = worktreeSet(branch, pi);
      ctx.ui.setStatus("pi-dev-worktrees", buildStatusString(state));
      ctx.ui.notify(r.message, r.ok ? "info" : "warning");
      if (r.ok && r.hookOutput) {
        ctx.ui.notify(r.hookOutput, "info");
      }
    },
  });

  pi.registerCommand("devcontainer", {
    description: "Manage devcontainer targeting. Usage: /devcontainer [on | off | stop | rebuild | logs]",
    handler: async (args, ctx) => {
      if (!devcontainersEnabled) {
        const r = disabledDevcontainerResult();
        ctx.ui.notify(r.message, "info");
        return;
      }
      const arg = args?.trim();
      if (!arg) {
        const r = devcontainerStatus();
        ctx.ui.notify(r.message, "info");
        return;
      }
      if (arg === "off") {
        const r = devcontainerOff(pi);
        ctx.ui.setStatus("pi-dev-worktrees", buildStatusString(state));
        ctx.ui.notify(r.message, r.ok ? "info" : "warning");
        return;
      }
      if (arg === "stop") {
        const r = doDevcontainerStop(pi);
        ctx.ui.setStatus("pi-dev-worktrees", buildStatusString(state));
        ctx.ui.notify(r.message, r.ok ? "info" : "warning");
        return;
      }
      if (arg === "rebuild") {
        const r = devcontainerRebuild(pi);
        ctx.ui.setStatus("pi-dev-worktrees", buildStatusString(state));
        ctx.ui.notify(r.message, r.ok ? "info" : "warning");
        return;
      }
      if (arg === "on") {
        const r = devcontainerOn(pi);
        ctx.ui.setStatus("pi-dev-worktrees", buildStatusString(state));
        ctx.ui.notify(r.message, r.ok ? "info" : "warning");
        return;
      }
      if (arg === "logs") {
        if (!devcontainerRoot) { ctx.ui.notify("No devcontainer workspace is available", "warning"); return; }
        const logTail = tailContainerLog(devcontainerRoot, 50);
        if (!logTail) {
          ctx.ui.notify(`No startup log found. Expected at: ${containerLogPath(devcontainerRoot)}`, "info");
        } else {
          ctx.ui.notify(logTail, "info");
        }
        return;
      }
      ctx.ui.notify("Usage: /devcontainer [on | off | stop | rebuild | logs]", "info");
    },
  });

}

