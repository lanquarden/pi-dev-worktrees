/**
 * Tests for rtk-compat.ts — detectRtkConflicts scenarios.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock devcontainer so probeContainerRtk doesn't actually exec anything
vi.mock("../src/devcontainer.js", () => ({
  readStartupOutcome: vi.fn(() => ({ outcome: null })),
  probeContainer: vi.fn(() => false),
  tailContainerLog: vi.fn(() => ""),
}));

import { detectRtkConflicts } from "../src/rtk-compat.js";
import type { ExtensionAPI, ExtensionContext, ToolInfo, SlashCommandInfo } from "@earendil-works/pi-coding-agent";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeToolInfo(name: string, path: string, source = "local"): ToolInfo {
  return {
    name,
    description: "",
    parameters: { type: "object", properties: {} },
    sourceInfo: {
      path,
      source,
      scope: "project" as const,
      origin: "extension" as const,
    },
  };
}

function makeCommandInfo(name: string, path = "/some/ext"): SlashCommandInfo {
  return {
    name,
    source: "extension",
    sourceInfo: {
      path,
      source: "local",
      scope: "project" as const,
      origin: "extension" as const,
    },
  };
}

function makeMocks(tools: ToolInfo[], commands: SlashCommandInfo[]) {
  const pi = {
    getAllTools: vi.fn(() => tools),
    getCommands: vi.fn(() => commands),
  } as unknown as ExtensionAPI;

  const notify = vi.fn();
  const ctx = {
    ui: { notify },
  } as unknown as ExtensionContext;

  return { pi, ctx, notify };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("detectRtkConflicts", () => {
  describe("Scenario: @sherif-fanous/pi-rtk detected", () => {
    it("emits a warning naming the conflicting extension", () => {
      const tools = [
        makeToolInfo("bash", "/home/user/.pi/agent/packages/node_modules/@sherif-fanous/pi-rtk/dist/index.js"),
      ];
      const { pi, ctx, notify } = makeMocks(tools, []);

      detectRtkConflicts(pi, ctx);

      expect(notify).toHaveBeenCalledOnce();
      const [message, level] = notify.mock.calls[0];
      expect(level).toBe("warning");
      expect(message).toContain("pi-rtk");
      expect(message).toContain("spawnHook");
      expect(message).toContain("pi-rtk-optimizer");
    });

    it("does NOT emit spawnHook warning if path contains pi-rtk-optimizer (emits generic override warning instead)", () => {
      // pi-rtk-optimizer uses tool_call mutation and should NOT override bash.
      // If it somehow did, we'd see the generic override warning, not the spawnHook warning.
      const tools = [
        makeToolInfo("bash", "/home/user/extensions/pi-rtk-optimizer/dist/index.js"),
      ];
      const { pi, ctx, notify } = makeMocks(tools, []);

      detectRtkConflicts(pi, ctx);

      // Must NOT emit the spawnHook-specific bad-rtk warning
      const badRtkCall = notify.mock.calls.find(([msg]: [string]) =>
        msg.includes("spawnHook"),
      );
      expect(badRtkCall).toBeUndefined();
    });

    it("does NOT emit if path contains pi-dev-worktrees", () => {
      const tools = [
        makeToolInfo("bash", "/home/user/extensions/pi-dev-worktrees/dist/index.js"),
      ];
      const { pi, ctx, notify } = makeMocks(tools, []);

      detectRtkConflicts(pi, ctx);

      expect(notify).not.toHaveBeenCalled();
    });
  });

  describe("Scenario: unknown bash tool override detected", () => {
    it("emits a generic warning for unknown bash tool override", () => {
      const tools = [
        makeToolInfo("bash", "/home/user/extensions/some-other-extension/dist/index.js"),
      ];
      const { pi, ctx, notify } = makeMocks(tools, []);

      detectRtkConflicts(pi, ctx);

      expect(notify).toHaveBeenCalledOnce();
      const [message, level] = notify.mock.calls[0];
      expect(level).toBe("warning");
      expect(message).toContain("overridden");
    });

    it("does NOT emit generic warning when bash is built-in", () => {
      const tools = [
        makeToolInfo("bash", "/built-in", "built-in"),
      ];
      const { pi, ctx, notify } = makeMocks(tools, []);

      detectRtkConflicts(pi, ctx);

      expect(notify).not.toHaveBeenCalled();
    });
  });

  describe("Scenario: pi-rtk-optimizer detected, load order unverified", () => {
    it("emits info advisory with settings.json snippet when /rtk command found and no incompatible override", () => {
      // bash is built-in, rtk-optimizer registers /rtk command
      const tools = [
        makeToolInfo("bash", "/built-in", "built-in"),
      ];
      const commands = [
        makeCommandInfo("rtk", "/home/user/extensions/pi-rtk-optimizer/dist/index.js"),
      ];
      const { pi, ctx, notify } = makeMocks(tools, commands);

      detectRtkConflicts(pi, ctx);

      expect(notify).toHaveBeenCalledOnce();
      const [message, level] = notify.mock.calls[0];
      expect(level).toBe("info");
      expect(message).toContain("pi-rtk-optimizer");
      expect(message).toContain("settings.json");
      expect(message).toContain("extensions");
    });

    it("emits info advisory when no bash tool at all but /rtk present", () => {
      const tools: ToolInfo[] = []; // no bash tool registered
      const commands = [
        makeCommandInfo("rtk"),
      ];
      const { pi, ctx, notify } = makeMocks(tools, commands);

      detectRtkConflicts(pi, ctx);

      expect(notify).toHaveBeenCalledOnce();
      expect(notify.mock.calls[0][1]).toBe("info");
    });
  });

  describe("Scenario: no RTK extension detected", () => {
    it("emits no notification when no bash override and no /rtk command", () => {
      const tools = [
        makeToolInfo("bash", "/built-in", "built-in"),
      ];
      const { pi, ctx, notify } = makeMocks(tools, []);

      detectRtkConflicts(pi, ctx);

      expect(notify).not.toHaveBeenCalled();
    });

    it("emits no notification when no tools at all and no commands", () => {
      const { pi, ctx, notify } = makeMocks([], []);

      detectRtkConflicts(pi, ctx);

      expect(notify).not.toHaveBeenCalled();
    });
  });
});
