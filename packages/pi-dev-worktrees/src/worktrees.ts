/**
 * worktrees.ts — wtp invocation and .wtp.yml auto-generation.
 */

import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as yaml from "js-yaml";

const DEFAULT_HOOKS_YAML = `    # Copy gitignored secrets from the main repo into the new worktree
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

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface WtpConfig {
  version?: string;
  defaults?: { base_dir?: string; [key: string]: unknown };
  hooks?: { post_create?: WtpHook[] };
  [key: string]: unknown;
}

export type WtpHook =
  | { type: "command"; command: string }
  | { type: "copy"; from: string; to: string }
  | { type: "symlink"; from: string; to: string }
  | Record<string, unknown>;

export interface CreateWorktreeResult {
  path: string;
  hookOutput: string;
}

// ──────────────────────────────────────────────
// YAML helpers
// ──────────────────────────────────────────────

/**
 * Parse .wtp.yml at projectRoot. Returns null if file doesn't exist.
 */
export function readWtpYml(projectRoot: string): WtpConfig | null {
  const wtpYmlPath = join(projectRoot, ".wtp.yml");
  if (!existsSync(wtpYmlPath)) return null;
  const content = readFileSync(wtpYmlPath, "utf8");
  return (yaml.load(content) as WtpConfig) ?? {};
}

/**
 * Write a WtpConfig back to .wtp.yml as YAML.
 */
export function writeWtpYml(projectRoot: string, config: WtpConfig): void {
  const wtpYmlPath = join(projectRoot, ".wtp.yml");
  const content = yaml.dump(config, { lineWidth: -1, noRefs: true });
  writeFileSync(wtpYmlPath, content, "utf8");
}

/**
 * Return the post_create hooks array (empty array if absent).
 */
export function listHooks(config: WtpConfig): WtpHook[] {
  return config.hooks?.post_create ?? [];
}

/**
 * Append a command hook; returns updated config (does not mutate input).
 */
export function addCommandHook(config: WtpConfig, command: string): WtpConfig {
  const hooks = listHooks(config);
  const newHook: WtpHook = { type: "command", command };
  return {
    ...config,
    hooks: {
      ...config.hooks,
      post_create: [...hooks, newHook],
    },
  };
}

/**
 * Remove hook at 1-based index; throws RangeError if out of bounds.
 * Returns updated config (does not mutate input).
 */
export function removeHook(config: WtpConfig, index: number): WtpConfig {
  const hooks = listHooks(config);
  if (index < 1 || index > hooks.length) {
    throw new RangeError(`Index ${index} is out of range (1..${hooks.length})`);
  }
  const newHooks = [...hooks.slice(0, index - 1), ...hooks.slice(index)];
  return {
    ...config,
    hooks: {
      ...config.hooks,
      post_create: newHooks,
    },
  };
}

/**
 * Format a single hook for display.
 */
export function formatHook(hook: WtpHook): string {
  const h = hook as Record<string, unknown>;
  if (h["type"] === "command") {
    const cmd = String(h["command"] ?? "").split("\n")[0].trim();
    return `command:  ${cmd}`;
  }
  if (h["type"] === "copy") {
    return `copy:     ${h["from"]} → ${h["to"]}`;
  }
  if (h["type"] === "symlink") {
    return `symlink:  ${h["from"]} → ${h["to"]}`;
  }
  return `unknown:  ${JSON.stringify(hook)}`;
}

// ──────────────────────────────────────────────
// Ensure .wtp.yml
// ──────────────────────────────────────────────

/**
 * Ensure .wtp.yml exists at projectRoot. If not, write the default template.
 * Returns true if the file was generated, false if it already existed.
 *
 * @param worktreeRoot - Value to use as base_dir (default: ".pi/worktrees")
 * @param postCreateHooks - Extra hooks to append after the two default hooks
 */
export function ensureWtpYml(
  projectRoot: string,
  worktreeRoot: string = ".pi/worktrees",
  postCreateHooks: WtpHook[] = [],
): boolean {
  const wtpYmlPath = join(projectRoot, ".wtp.yml");
  if (existsSync(wtpYmlPath)) {
    return false;
  }

  let extraHooksYaml = "";
  if (postCreateHooks.length > 0) {
    // Indent each hook entry by 4 spaces to sit under post_create:
    extraHooksYaml = postCreateHooks
      .map((hook) => {
        const lines = yaml.dump([hook], { lineWidth: -1, noRefs: true }).trim().split("\n");
        return lines.map((l) => `    ${l}`).join("\n");
      })
      .join("\n") + "\n";
  }

  const content = `version: "1.0"
defaults:
  base_dir: ${JSON.stringify(worktreeRoot)}

hooks:
  post_create:
${DEFAULT_HOOKS_YAML}${extraHooksYaml}`;

  writeFileSync(wtpYmlPath, content, "utf8");
  return true;
}

// ──────────────────────────────────────────────
// Worktree creation
// ──────────────────────────────────────────────

/**
 * Create or target a worktree for the given branch.
 * Returns { path, hookOutput } where hookOutput is the captured wtp output.
 */
export function createOrTargetWorktree(
  branch: string,
  projectRoot: string,
  worktreeRoot: string = ".pi/worktrees",
): CreateWorktreeResult {
  const resolvedRoot = resolve(projectRoot, worktreeRoot);
  const worktreePath = join(resolvedRoot, branch);

  let hookOutput = "";

  if (!existsSync(worktreePath)) {
    // Check if branch exists locally
    let localExists = false;
    let remoteExists = false;

    try {
      const localOut = execSync(`git branch --list ${shellEscapeArg(branch)}`, {
        cwd: projectRoot,
        encoding: "utf8",
      });
      localExists = localOut.trim().length > 0;
    } catch {
      // ignore
    }

    if (!localExists) {
      try {
        const remoteOut = execSync(
          `git ls-remote --heads origin ${shellEscapeArg(branch)}`,
          { cwd: projectRoot, encoding: "utf8" },
        );
        remoteExists = remoteOut.trim().length > 0;
      } catch {
        // ignore
      }
    }

    const wtpArgs = localExists || remoteExists
      ? ["add", branch]
      : ["add", "-b", branch];

    // If branch exists only on remote, create a local tracking branch first
    if (remoteExists && !localExists) {
      try {
        execSync(`git fetch origin ${shellEscapeArg(branch)}`, { cwd: projectRoot, encoding: "utf8" });
      } catch { /* ignore */ }
      try {
        execSync(`git branch --track ${shellEscapeArg(branch)} origin/${branch}`, { cwd: projectRoot, encoding: "utf8" });
      } catch { /* ignore — may already exist */ }
    }

    const result = spawnSync("wtp", wtpArgs, {
      cwd: projectRoot,
      encoding: "utf8",
    });

    hookOutput = ((result.stdout ?? "") + (result.stderr ?? "")).trim();

    if (result.status !== 0) {
      throw new Error(`wtp add failed: ${hookOutput}`);
    }
  }

  // Align existing worktree HEAD with requested branch if it differs
  try {
    if (existsSync(worktreePath)) {
      const head = execSync("git rev-parse --abbrev-ref HEAD", { cwd: worktreePath, encoding: "utf8" }).trim();
      if (head && head !== branch) {
        try {
          execSync(`git switch ${shellEscapeArg(branch)}`, { cwd: worktreePath, encoding: "utf8" });
          hookOutput += (hookOutput ? "\n" : "") + `Switched worktree HEAD from '${head}' to '${branch}'.`;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          hookOutput += (hookOutput ? "\n" : "") + `Warning: worktree at '${worktreePath}' is on '${head}', expected '${branch}'. Failed to switch: ${msg}`;
        }
      }
    }
  } catch { /* best-effort */ }

  // Ensure the worktree root is in .gitignore (only for relative paths under projectRoot)
  const relEntry = worktreeRoot.startsWith("/") ? null : worktreeRoot.replace(/\/*$/, "/");
  if (relEntry) ensureGitignoreEntry(projectRoot, relEntry);

  return { path: worktreePath, hookOutput };
}

// ──────────────────────────────────────────────
// wtp list parsing
// ──────────────────────────────────────────────

/**
 * Parse the output of `wtp list --quiet` into branch names.
 *
 * `wtp list --quiet` prints one entry per line:
 *   - "@" for the main worktree (always first, skip it)
 *   - bare branch name for each managed worktree (e.g. "feature/foo")
 *
 * Returns only the managed branch names ("@" and blank lines excluded).
 */
export function parseWtpListQuiet(output: string): string[] {
  return output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l !== "@");
}

/**
 * List worktrees managed by wtp for the given project.
 *
 * Runs `wtp list --quiet`, parses branch names, resolves each to an
 * absolute path under worktreesRoot, and skips entries whose path does
 * not exist on disk. Falls back to enumerateWorktreeDirs on wtp failure.
 *
 * @param projectRoot   - absolute path to the git repo root
 * @param worktreesRoot - absolute path to the wtp base_dir
 * @param exec          - execSync-compatible function (injectable for tests)
 * @param pathExists    - existsSync-compatible function (injectable for tests)
 */
export function listWtpWorktrees(
  projectRoot: string,
  worktreesRoot: string,
  exec: (cmd: string, opts: { cwd: string; encoding: "utf8" }) => string = (cmd, opts) =>
    execSync(cmd, opts),
  pathExists: (p: string) => boolean = existsSync,
): Array<{ branch: string; path: string }> {
  let raw: string;
  try {
    raw = exec("wtp list --quiet", { cwd: projectRoot, encoding: "utf8" }).trim();
  } catch {
    return [];
  }
  if (!raw) return [];

  const results: Array<{ branch: string; path: string }> = [];
  for (const branch of parseWtpListQuiet(raw)) {
    const wtPath = join(worktreesRoot, branch);
    if (!pathExists(wtPath)) continue;
    results.push({ branch, path: wtPath });
  }
  return results;
}

// ──────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────

/**
 * Append a pattern to .gitignore if not already present.
 */
export function ensureGitignoreEntry(projectRoot: string, pattern: string): void {
  const gitignorePath = join(projectRoot, ".gitignore");
  let existing = "";

  if (existsSync(gitignorePath)) {
    existing = readFileSync(gitignorePath, "utf8");
    const lines = existing.split("\n");
    if (lines.some((l) => l.trim() === pattern)) {
      return;
    }
  }

  const separator = existing.endsWith("\n") || existing.length === 0 ? "" : "\n";
  appendFileSync(gitignorePath, `${separator}${pattern}\n`, "utf8");
}

/**
 * Simple shell argument escaping (single-quote wrapping).
 */
export function shellEscapeArg(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
