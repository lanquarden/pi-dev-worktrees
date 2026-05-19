/**
 * worktrees.ts — wtp invocation and .wtp.yml auto-generation.
 */

import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as yaml from "js-yaml";

const WTP_YML_CONTENT = `version: "1.0"
defaults:
  base_dir: ".pi/worktrees"

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
 */
export function ensureWtpYml(projectRoot: string): boolean {
  const wtpYmlPath = join(projectRoot, ".wtp.yml");
  if (existsSync(wtpYmlPath)) {
    return false;
  }
  writeFileSync(wtpYmlPath, WTP_YML_CONTENT, "utf8");
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
): CreateWorktreeResult {
  const worktreePath = join(projectRoot, ".pi", "worktrees", branch);

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

    const result = spawnSync("wtp", wtpArgs, {
      cwd: projectRoot,
      encoding: "utf8",
    });

    hookOutput = ((result.stdout ?? "") + (result.stderr ?? "")).trim();

    if (result.status !== 0) {
      throw new Error(`wtp add failed: ${hookOutput}`);
    }
  }

  // Ensure .pi/worktrees/ is in .gitignore
  ensureGitignoreEntry(projectRoot, ".pi/worktrees/");

  return { path: worktreePath, hookOutput };
}

// ──────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────

/**
 * Append a pattern to .gitignore if not already present.
 */
function ensureGitignoreEntry(projectRoot: string, pattern: string): void {
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
function shellEscapeArg(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
