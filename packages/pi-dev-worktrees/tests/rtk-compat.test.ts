/**
 * Tests for rtk-compat.ts — detectRtkConflicts scenarios.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

    it("does NOT emit generic warning when bash path is <builtin:bash>", () => {
      // Actual path observed at runtime when the built-in bash tool is active.
      // source is not "built-in" in this case, so the path must be checked.
      const tools = [
        makeToolInfo("bash", "<builtin:bash>", "local"),
      ];
      const { pi, ctx, notify } = makeMocks(tools, []);

      detectRtkConflicts(pi, ctx);

      expect(notify).not.toHaveBeenCalled();
    });
  });

  describe("Scenario: pi-rtk-optimizer detected, load order unverified", () => {
    it("emits info advisory with settings.json snippet when /rtk command found and no incompatible override (mode=always)", () => {
      // bash is built-in, rtk-optimizer registers /rtk command
      const tools = [
        makeToolInfo("bash", "/built-in", "built-in"),
      ];
      const commands = [
        makeCommandInfo("rtk", "/home/user/extensions/pi-rtk-optimizer/dist/index.js"),
      ];
      const { pi, ctx, notify } = makeMocks(tools, commands);

      detectRtkConflicts(pi, ctx, { rtkLoadOrderMode: "always" });

      expect(notify).toHaveBeenCalledOnce();
      const [message, level] = notify.mock.calls[0];
      expect(level).toBe("info");
      expect(message).toContain("pi-rtk-optimizer");
      expect(message).toContain("settings.json");
      expect(message).toContain("extensions");
    });

    it("emits info advisory when no bash tool at all but /rtk present (mode=always)", () => {
      const tools: ToolInfo[] = []; // no bash tool registered
      const commands = [
        makeCommandInfo("rtk"),
      ];
      const { pi, ctx, notify } = makeMocks(tools, commands);

      detectRtkConflicts(pi, ctx, { rtkLoadOrderMode: "always" });

      expect(notify).toHaveBeenCalledOnce();
      expect(notify.mock.calls[0][1]).toBe("info");
    });
  });

  describe("Scenario: rtkLoadOrder advisory mode gating", () => {
    it("mode=once emits on first session and persists a marker", () => {
      const dir = mkdtempSync(join(tmpdir(), "pi-dw-advisory-"));
      const statePath = join(dir, "advisory-state.json");
      const tools = [makeToolInfo("bash", "/built-in", "built-in")];
      const commands = [makeCommandInfo("rtk")];

      try {
        const { pi, ctx, notify } = makeMocks(tools, commands);
        detectRtkConflicts(pi, ctx, {
          rtkLoadOrderMode: "once",
          advisoryStatePath: statePath,
        });

        expect(notify).toHaveBeenCalledOnce();
        expect(notify.mock.calls[0][1]).toBe("info");
        // marker file must now exist
        expect(() => readFileSync(statePath, "utf8")).not.toThrow();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("mode=once suppresses on a subsequent session once marker exists", () => {
      const dir = mkdtempSync(join(tmpdir(), "pi-dw-advisory-"));
      const statePath = join(dir, "advisory-state.json");
      writeFileSync(statePath, JSON.stringify({ rtkLoadOrderShownAt: "1970-01-01T00:00:00.000Z" }), "utf8");
      const tools = [makeToolInfo("bash", "/built-in", "built-in")];
      const commands = [makeCommandInfo("rtk")];

      try {
        const { pi, ctx, notify } = makeMocks(tools, commands);
        detectRtkConflicts(pi, ctx, {
          rtkLoadOrderMode: "once",
          advisoryStatePath: statePath,
        });

        expect(notify).not.toHaveBeenCalled();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("mode=off never emits and does not read marker", () => {
      const dir = mkdtempSync(join(tmpdir(), "pi-dw-advisory-"));
      const statePath = join(dir, "advisory-state.json");
      const tools = [makeToolInfo("bash", "/built-in", "built-in")];
      const commands = [makeCommandInfo("rtk")];

      try {
        const { pi, ctx, notify } = makeMocks(tools, commands);
        detectRtkConflicts(pi, ctx, {
          rtkLoadOrderMode: "off",
          advisoryStatePath: statePath,
        });

        expect(notify).not.toHaveBeenCalled();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("Check A spawnHook warning still fires under mode=off (warnings are not gated)", () => {
      const tools = [
        makeToolInfo("bash", "/home/user/.pi/agent/packages/node_modules/@sherif-fanous/pi-rtk/dist/index.js"),
      ];
      const { pi, ctx, notify } = makeMocks(tools, [makeCommandInfo("rtk")]);

      detectRtkConflicts(pi, ctx, { rtkLoadOrderMode: "off" });

      // Check A warning must still fire even when the advisory is off
      expect(notify).toHaveBeenCalledOnce();
      expect(notify.mock.calls[0][1]).toBe("warning");
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
