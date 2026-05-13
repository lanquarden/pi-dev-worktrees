/**
 * worktrees.ts — wtp invocation and .wtp.yml auto-generation.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

/**
 * Create or target a worktree for the given branch.
 * Returns the absolute path of the worktree.
 */
export function createOrTargetWorktree(
  branch: string,
  projectRoot: string,
): string {
  const worktreePath = join(projectRoot, ".pi", "worktrees", branch);

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

    if (localExists || remoteExists) {
      execSync(`wtp add ${shellEscapeArg(branch)}`, {
        cwd: projectRoot,
        encoding: "utf8",
      });
    } else {
      execSync(`wtp add -b ${shellEscapeArg(branch)}`, {
        cwd: projectRoot,
        encoding: "utf8",
      });
    }
  }

  // Ensure .pi/worktrees/ is in .gitignore
  ensureGitignoreEntry(projectRoot, ".pi/worktrees/");

  return worktreePath;
}

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
