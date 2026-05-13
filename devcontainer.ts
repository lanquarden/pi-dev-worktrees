/**
 * devcontainer.ts — Devcontainer probe, start, and config generation.
 */

import { execSync, spawn } from "node:child_process";
import { existsSync, writeFileSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const OVERRIDE_JSON_CONTENT = JSON.stringify(
  {
    workspaceMount:
      "source=${localWorkspaceFolder},target=${localWorkspaceFolder},type=bind",
    workspaceFolder: "${localWorkspaceFolder}",
  },
  null,
  2,
);

/**
 * Find a devcontainer config at the project root.
 * Returns the path if found, null otherwise.
 */
export function findDevcontainerConfig(projectRoot: string): string | null {
  const candidates = [
    join(projectRoot, ".devcontainer", "devcontainer.json"),
    join(projectRoot, ".devcontainer.json"),
  ];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  return null;
}

/**
 * Generate .pi/devcontainer.override.json if not already present.
 * Also ensures .pi/devcontainer.override.json is in .gitignore.
 */
export function generateOverrideJson(projectRoot: string): void {
  const overridePath = join(projectRoot, ".pi", "devcontainer.override.json");
  if (existsSync(overridePath)) return;

  writeFileSync(overridePath, OVERRIDE_JSON_CONTENT + "\n", "utf8");

  // Add to .gitignore if not present
  const gitignorePath = join(projectRoot, ".gitignore");
  const pattern = ".pi/devcontainer.override.json";
  let existing = "";

  if (existsSync(gitignorePath)) {
    existing = readFileSync(gitignorePath, "utf8");
    const lines = existing.split("\n");
    if (lines.some((l) => l.trim() === pattern)) return;
  }

  const separator = existing.endsWith("\n") || existing.length === 0 ? "" : "\n";
  appendFileSync(gitignorePath, `${separator}${pattern}\n`, "utf8");
}

/**
 * Probe whether the devcontainer is running.
 * Returns true if the container responds within 2 seconds.
 */
export function probeContainer(projectRoot: string): boolean {
  const overridePath = join(projectRoot, ".pi", "devcontainer.override.json");
  try {
    const result = execSync(
      `devcontainer exec --workspace-folder ${shellQuote(projectRoot)} --override-config ${shellQuote(overridePath)} -- echo ok`,
      { timeout: 2000, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return result.trim().includes("ok");
  } catch {
    return false;
  }
}

/**
 * Start the devcontainer in the background (detached, fire-and-forget).
 */
export function startContainer(projectRoot: string): void {
  const overridePath = join(projectRoot, ".pi", "devcontainer.override.json");
  const child = spawn(
    "devcontainer",
    [
      "up",
      "--workspace-folder",
      projectRoot,
      "--override-config",
      overridePath,
    ],
    {
      detached: true,
      stdio: "ignore",
      cwd: projectRoot,
    },
  );
  child.unref();
}

/**
 * Shell-safe single-quote wrapping for path arguments.
 */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
