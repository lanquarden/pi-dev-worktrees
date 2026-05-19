/**
 * config.ts — Per-repo plugin configuration loader and resolver.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { WtpHook } from "./worktrees.js";

export interface RepoEntry {
  repoGlob: string;
  worktreeRoot: string;
  postCreateHooks?: WtpHook[];
}

export interface PluginConfig {
  repos: RepoEntry[];
}

export const CONFIG_PATH = path.join(
  os.homedir(),
  ".pi",
  "agent",
  "pi-dev-worktrees.config.json",
);

/**
 * Load the plugin config from CONFIG_PATH (or an override path for testing).
 * Returns null if the file is absent (silently) or if the JSON is invalid (with a warning).
 */
export function loadPluginConfig(configPath: string = CONFIG_PATH): PluginConfig | null {
  if (!fs.existsSync(configPath)) return null;
  let content: string;
  try {
    content = fs.readFileSync(configPath, "utf8");
  } catch {
    return null;
  }
  try {
    return JSON.parse(content) as PluginConfig;
  } catch (err) {
    console.warn(
      `pi-dev-worktrees: failed to parse config at ${configPath}: ${String(err)}`,
    );
    return null;
  }
}

/**
 * Test whether a glob pattern matches a URL string.
 * Only `*` is treated as a wildcard (matches any sequence of characters,
 * including `/`). Matching is case-sensitive.
 */
export function matchRepoGlob(pattern: string, url: string): boolean {
  // Escape all regex metacharacters except `*`, then replace `*` with `.*`
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${regexStr}$`).test(url);
}

/**
 * Return the worktreeRoot for the first matching entry in config.repos,
 * falling back to ".pi/worktrees" when no entry matches or config is null.
 */
export function resolveWorktreeRoot(
  remoteUrl: string,
  config: PluginConfig | null,
): string {
  if (!config) return ".pi/worktrees";
  for (const entry of config.repos) {
    if (matchRepoGlob(entry.repoGlob, remoteUrl)) {
      return entry.worktreeRoot;
    }
  }
  return ".pi/worktrees";
}

/**
 * Return the postCreateHooks for the first matching entry in config.repos.
 * Returns [] when no entry matches, when the match has no hooks, or when config is null.
 */
export function resolvePostCreateHooks(
  remoteUrl: string,
  config: PluginConfig | null,
): WtpHook[] {
  if (!config) return [];
  for (const entry of config.repos) {
    if (matchRepoGlob(entry.repoGlob, remoteUrl)) {
      return entry.postCreateHooks ?? [];
    }
  }
  return [];
}
