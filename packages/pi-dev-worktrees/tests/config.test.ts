/**
 * Tests for src/config.ts — loadPluginConfig, matchRepoGlob,
 * resolveWorktreeRoot, resolvePostCreateHooks.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadPluginConfig,
  matchRepoGlob,
  areWorktreesEnabled,
  isDevcontainerEnabled,
  resolveWorktreeRoot,
  resolvePostCreateHooks,
} from "../src/config.js";
import type { PluginConfig } from "../src/config.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "pi-dev-worktrees-config-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ── loadPluginConfig ──────────────────────────────────────────────────────────

describe("loadPluginConfig", () => {
  it("Scenario 1.A — absent file returns null with no warning", () => {
    const warnSpy = vi.spyOn(console, "warn");
    const nonexistent = join(tmpDir, "not-there.json");
    const result = loadPluginConfig(nonexistent);
    expect(result).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("Scenario 1.B — valid JSON returns parsed PluginConfig including postCreateHooks", () => {
    const configPath = join(tmpDir, "config.json");
    const configData: PluginConfig = {
      repos: [
        {
          repoGlob: "github.com/org/*",
          worktreeRoot: "/ssd/wt",
          postCreateHooks: [{ type: "command", command: "mise install" }],
        },
      ],
    };
    writeFileSync(configPath, JSON.stringify(configData), "utf8");

    const result = loadPluginConfig(configPath);
    expect(result).not.toBeNull();
    expect(result!.repos).toHaveLength(1);
    expect(result!.repos[0].repoGlob).toBe("github.com/org/*");
    expect(result!.repos[0].worktreeRoot).toBe("/ssd/wt");
    expect(result!.repos[0].postCreateHooks).toHaveLength(1);
    expect((result!.repos[0].postCreateHooks![0] as Record<string, unknown>)["command"]).toBe("mise install");
  });

  it("Scenario 1.C — invalid JSON returns null and calls console.warn with path and error", () => {
    const configPath = join(tmpDir, "config.json");
    writeFileSync(configPath, "{ not valid json }", "utf8");

    const warnSpy = vi.spyOn(console, "warn");
    const result = loadPluginConfig(configPath);
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledOnce();
    const warnArg = String(warnSpy.mock.calls[0][0]);
    expect(warnArg).toContain(configPath);
    expect(warnArg.toLowerCase()).toMatch(/json|parse|syntax/i);
  });
});

// ── capability flags ──────────────────────────────────────────────────────────

describe("capability flags", () => {
  it("default both capabilities to enabled", () => {
    expect(areWorktreesEnabled(null)).toBe(true);
    expect(isDevcontainerEnabled(null)).toBe(true);
    expect(areWorktreesEnabled({ repos: [] })).toBe(true);
    expect(isDevcontainerEnabled({ repos: [] })).toBe(true);
  });

  it("disables only on explicit false and supports all four combinations", () => {
    for (const worktrees of [true, false]) {
      for (const devcontainer of [true, false]) {
        const config: PluginConfig = {
          worktrees: { enabled: worktrees },
          devcontainer: { enabled: devcontainer },
        };
        expect(areWorktreesEnabled(config)).toBe(worktrees);
        expect(isDevcontainerEnabled(config)).toBe(devcontainer);
      }
    }
  });

  it("accepts minimal external-worktree config with omitted repos", () => {
    const config: PluginConfig = {
      worktrees: { enabled: false },
      devcontainer: { enabled: true },
    };
    expect(areWorktreesEnabled(config)).toBe(false);
    expect(isDevcontainerEnabled(config)).toBe(true);
    expect(resolveWorktreeRoot("", config)).toBe(".pi/worktrees");
    expect(resolvePostCreateHooks("", config)).toEqual([]);
  });
});

// ── matchRepoGlob ─────────────────────────────────────────────────────────────

describe("matchRepoGlob", () => {
  it("Scenario 2.A — exact match returns true", () => {
    expect(matchRepoGlob("github.com/org/repo", "github.com/org/repo")).toBe(true);
  });

  it("Scenario 2.B — wildcard org match returns true for both repos", () => {
    expect(matchRepoGlob("github.com/org/*", "github.com/org/my-repo")).toBe(true);
    expect(matchRepoGlob("github.com/org/*", "github.com/org/other-repo")).toBe(true);
  });

  it("Scenario 2.C — wildcard does not match across different prefix", () => {
    expect(matchRepoGlob("github.com/org/*", "gitlab.com/org/repo")).toBe(false);
  });

  it("Scenario 2.D — catch-all * matches any URL", () => {
    expect(matchRepoGlob("*", "github.com/anything/at-all")).toBe(true);
    expect(matchRepoGlob("*", "")).toBe(true);
  });

  it("Scenario 2.E — no match returns false", () => {
    expect(matchRepoGlob("github.com/a/*", "github.com/b/repo")).toBe(false);
  });

  it("Scenario 2.F — matching is case-sensitive", () => {
    expect(matchRepoGlob("github.com/Org/*", "github.com/org/repo")).toBe(false);
  });

  it("does not treat ? as wildcard", () => {
    expect(matchRepoGlob("github.com/org/rep?", "github.com/org/repo")).toBe(false);
  });

  it("* matches slash characters", () => {
    expect(matchRepoGlob("github.com/*", "github.com/org/repo")).toBe(true);
  });
});

// ── resolveWorktreeRoot ───────────────────────────────────────────────────────

describe("resolveWorktreeRoot", () => {
  it("Scenario 3.A — first match wins (specific entry before wildcard)", () => {
    const config: PluginConfig = {
      repos: [
        { repoGlob: "github.com/org/specific", worktreeRoot: "/ssd/specific" },
        { repoGlob: "github.com/org/*", worktreeRoot: "/ssd/org" },
        { repoGlob: "*", worktreeRoot: ".pi/worktrees" },
      ],
    };
    expect(resolveWorktreeRoot("github.com/org/specific", config)).toBe("/ssd/specific");
  });

  it("Scenario 3.B — falls back to second entry when first doesn't match", () => {
    const config: PluginConfig = {
      repos: [
        { repoGlob: "github.com/org/specific", worktreeRoot: "/ssd/specific" },
        { repoGlob: "github.com/org/*", worktreeRoot: "/ssd/org" },
        { repoGlob: "*", worktreeRoot: ".pi/worktrees" },
      ],
    };
    expect(resolveWorktreeRoot("github.com/org/other", config)).toBe("/ssd/org");
  });

  it("Scenario 3.C — no match in config returns .pi/worktrees", () => {
    const config: PluginConfig = {
      repos: [{ repoGlob: "github.com/org/*", worktreeRoot: "/ssd/org" }],
    };
    expect(resolveWorktreeRoot("gitlab.com/other/repo", config)).toBe(".pi/worktrees");
  });

  it("Scenario 3.D — null config returns .pi/worktrees", () => {
    expect(resolveWorktreeRoot("github.com/org/repo", null)).toBe(".pi/worktrees");
  });

  it("empty repos array returns .pi/worktrees", () => {
    expect(resolveWorktreeRoot("github.com/org/repo", { repos: [] })).toBe(".pi/worktrees");
  });
});

// ── resolvePostCreateHooks ────────────────────────────────────────────────────

describe("resolvePostCreateHooks", () => {
  it("Scenario 4.A — returns hooks from matching entry", () => {
    const config: PluginConfig = {
      repos: [
        {
          repoGlob: "github.com/org/*",
          worktreeRoot: ".pi/worktrees",
          postCreateHooks: [{ type: "command", command: "mise install" }],
        },
      ],
    };
    const hooks = resolvePostCreateHooks("github.com/org/my-repo", config);
    expect(hooks).toHaveLength(1);
    expect((hooks[0] as Record<string, unknown>)["command"]).toBe("mise install");
  });

  it("Scenario 4.B — matching entry without hooks returns []", () => {
    const config: PluginConfig = {
      repos: [{ repoGlob: "github.com/org/*", worktreeRoot: ".pi/worktrees" }],
    };
    expect(resolvePostCreateHooks("github.com/org/my-repo", config)).toEqual([]);
  });

  it("Scenario 4.C — no match returns []", () => {
    const config: PluginConfig = {
      repos: [
        {
          repoGlob: "github.com/org/*",
          worktreeRoot: ".pi/worktrees",
          postCreateHooks: [{ type: "command", command: "mise install" }],
        },
      ],
    };
    expect(resolvePostCreateHooks("gitlab.com/other/repo", config)).toEqual([]);
  });

  it("Scenario 4.D — null config returns []", () => {
    expect(resolvePostCreateHooks("github.com/org/repo", null)).toEqual([]);
  });

  it("returns [] for empty repos array", () => {
    expect(resolvePostCreateHooks("github.com/org/repo", { repos: [] })).toEqual([]);
  });

  it("first-match-wins for hooks too", () => {
    const config: PluginConfig = {
      repos: [
        {
          repoGlob: "github.com/org/specific",
          worktreeRoot: ".pi/worktrees",
          postCreateHooks: [{ type: "command", command: "specific-cmd" }],
        },
        {
          repoGlob: "github.com/org/*",
          worktreeRoot: ".pi/worktrees",
          postCreateHooks: [{ type: "command", command: "wildcard-cmd" }],
        },
      ],
    };
    const hooks = resolvePostCreateHooks("github.com/org/specific", config);
    expect(hooks).toHaveLength(1);
    expect((hooks[0] as Record<string, unknown>)["command"]).toBe("specific-cmd");
  });
});
