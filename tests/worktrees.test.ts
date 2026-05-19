/**
 * Tests for worktrees.ts YAML helpers.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  readWtpYml,
  writeWtpYml,
  listHooks,
  addCommandHook,
  removeHook,
  formatHook,
} from "../src/worktrees.js";
import type { WtpConfig, WtpHook } from "../src/worktrees.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "pi-dev-worktrees-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── readWtpYml ────────────────────────────────────────────────────────────────

describe("readWtpYml", () => {
  it("returns null when file does not exist", () => {
    expect(readWtpYml(tmpDir)).toBeNull();
  });

  it("parses valid YAML correctly", () => {
    const content = `version: "1.0"
defaults:
  base_dir: ".pi/worktrees"
hooks:
  post_create:
    - type: command
      command: npm install
    - type: copy
      from: .env
      to: .env
`;
    writeFileSync(join(tmpDir, ".wtp.yml"), content, "utf8");
    const config = readWtpYml(tmpDir);
    expect(config).not.toBeNull();
    expect(config!.version).toBe("1.0");
    expect(config!.defaults?.base_dir).toBe(".pi/worktrees");
    expect(config!.hooks?.post_create).toHaveLength(2);
    expect((config!.hooks!.post_create![0] as Record<string, unknown>)["type"]).toBe("command");
    expect((config!.hooks!.post_create![0] as Record<string, unknown>)["command"]).toBe("npm install");
  });

  it("returns empty object for empty YAML file", () => {
    writeFileSync(join(tmpDir, ".wtp.yml"), "", "utf8");
    const config = readWtpYml(tmpDir);
    expect(config).toEqual({});
  });
});

// ── listHooks ─────────────────────────────────────────────────────────────────

describe("listHooks", () => {
  it("returns empty array for empty config", () => {
    expect(listHooks({})).toEqual([]);
  });

  it("returns empty array when hooks key is absent", () => {
    const config: WtpConfig = { version: "1.0" };
    expect(listHooks(config)).toEqual([]);
  });

  it("returns empty array when post_create is absent", () => {
    const config: WtpConfig = { hooks: {} };
    expect(listHooks(config)).toEqual([]);
  });

  it("returns hooks array when present", () => {
    const hooks: WtpHook[] = [
      { type: "command", command: "npm install" },
      { type: "copy", from: ".env", to: ".env" },
    ];
    const config: WtpConfig = { hooks: { post_create: hooks } };
    expect(listHooks(config)).toEqual(hooks);
  });
});

// ── addCommandHook ────────────────────────────────────────────────────────────

describe("addCommandHook", () => {
  it("appends a command hook to an empty config", () => {
    const config: WtpConfig = {};
    const updated = addCommandHook(config, "npm install");
    expect(listHooks(updated)).toHaveLength(1);
    expect((listHooks(updated)[0] as Record<string, unknown>)["type"]).toBe("command");
    expect((listHooks(updated)[0] as Record<string, unknown>)["command"]).toBe("npm install");
  });

  it("appends to existing hooks", () => {
    const config: WtpConfig = {
      hooks: { post_create: [{ type: "command", command: "mise install" }] },
    };
    const updated = addCommandHook(config, "npm install");
    expect(listHooks(updated)).toHaveLength(2);
    expect((listHooks(updated)[1] as Record<string, unknown>)["command"]).toBe("npm install");
  });

  it("does not mutate the input config", () => {
    const config: WtpConfig = {
      hooks: { post_create: [{ type: "command", command: "mise install" }] },
    };
    addCommandHook(config, "npm install");
    expect(listHooks(config)).toHaveLength(1);
  });
});

// ── removeHook ────────────────────────────────────────────────────────────────

describe("removeHook", () => {
  it("removes a hook at the correct 1-based index", () => {
    const config: WtpConfig = {
      hooks: {
        post_create: [
          { type: "command", command: "npm install" },
          { type: "command", command: "mise install" },
          { type: "copy", from: ".env", to: ".env" },
        ],
      },
    };
    const updated = removeHook(config, 2);
    const hooks = listHooks(updated);
    expect(hooks).toHaveLength(2);
    expect((hooks[0] as Record<string, unknown>)["command"]).toBe("npm install");
    expect((hooks[1] as Record<string, unknown>)["from"]).toBe(".env");
  });

  it("removes the first hook", () => {
    const config: WtpConfig = {
      hooks: {
        post_create: [
          { type: "command", command: "first" },
          { type: "command", command: "second" },
        ],
      },
    };
    const updated = removeHook(config, 1);
    const hooks = listHooks(updated);
    expect(hooks).toHaveLength(1);
    expect((hooks[0] as Record<string, unknown>)["command"]).toBe("second");
  });

  it("removes the last hook", () => {
    const config: WtpConfig = {
      hooks: {
        post_create: [
          { type: "command", command: "first" },
          { type: "command", command: "second" },
        ],
      },
    };
    const updated = removeHook(config, 2);
    const hooks = listHooks(updated);
    expect(hooks).toHaveLength(1);
    expect((hooks[0] as Record<string, unknown>)["command"]).toBe("first");
  });

  it("throws RangeError for index 0", () => {
    const config: WtpConfig = {
      hooks: { post_create: [{ type: "command", command: "npm install" }] },
    };
    expect(() => removeHook(config, 0)).toThrow(RangeError);
  });

  it("throws RangeError for out-of-bounds index", () => {
    const config: WtpConfig = {
      hooks: { post_create: [{ type: "command", command: "npm install" }] },
    };
    expect(() => removeHook(config, 5)).toThrow(RangeError);
  });

  it("throws RangeError for empty hooks list", () => {
    const config: WtpConfig = {};
    expect(() => removeHook(config, 1)).toThrow(RangeError);
  });

  it("does not mutate the input config", () => {
    const config: WtpConfig = {
      hooks: {
        post_create: [
          { type: "command", command: "npm install" },
          { type: "command", command: "mise install" },
        ],
      },
    };
    removeHook(config, 1);
    expect(listHooks(config)).toHaveLength(2);
  });
});

// ── formatHook ────────────────────────────────────────────────────────────────

describe("formatHook", () => {
  it("formats a command hook", () => {
    const hook: WtpHook = { type: "command", command: "npm install" };
    expect(formatHook(hook)).toBe("command:  npm install");
  });

  it("formats a multi-line command hook (uses first line)", () => {
    const hook: WtpHook = { type: "command", command: "npm install\nsome other line" };
    expect(formatHook(hook)).toBe("command:  npm install");
  });

  it("formats a copy hook", () => {
    const hook: WtpHook = { type: "copy", from: ".env", to: ".env" };
    expect(formatHook(hook)).toBe("copy:     .env → .env");
  });

  it("formats a symlink hook", () => {
    const hook: WtpHook = { type: "symlink", from: ".bin", to: ".bin" };
    expect(formatHook(hook)).toBe("symlink:  .bin → .bin");
  });

  it("formats an unknown hook type", () => {
    const hook = { type: "unknown-type", foo: "bar" } as unknown as WtpHook;
    const result = formatHook(hook);
    expect(result).toContain("unknown:");
  });
});

// ── writeWtpYml / readWtpYml round-trip ──────────────────────────────────────

describe("writeWtpYml / readWtpYml round-trip", () => {
  it("writes and reads back the same structure", () => {
    const config: WtpConfig = {
      version: "1.0",
      defaults: { base_dir: ".pi/worktrees" },
      hooks: {
        post_create: [
          { type: "command", command: "npm install" },
          { type: "copy", from: ".env", to: ".env" },
          { type: "symlink", from: ".bin", to: ".bin" },
        ],
      },
    };
    writeWtpYml(tmpDir, config);
    const read = readWtpYml(tmpDir);
    expect(read).not.toBeNull();
    expect(read!.version).toBe(config.version);
    expect(read!.defaults?.base_dir).toBe(".pi/worktrees");
    const hooks = listHooks(read!);
    expect(hooks).toHaveLength(3);
    expect((hooks[0] as Record<string, unknown>)["type"]).toBe("command");
    expect((hooks[0] as Record<string, unknown>)["command"]).toBe("npm install");
    expect((hooks[1] as Record<string, unknown>)["type"]).toBe("copy");
    expect((hooks[2] as Record<string, unknown>)["type"]).toBe("symlink");
  });

  it("writes a file that can be parsed by readWtpYml", () => {
    const config: WtpConfig = { hooks: { post_create: [] } };
    writeWtpYml(tmpDir, config);
    expect(existsSync(join(tmpDir, ".wtp.yml"))).toBe(true);
    const content = readFileSync(join(tmpDir, ".wtp.yml"), "utf8");
    expect(content.length).toBeGreaterThan(0);
    const read = readWtpYml(tmpDir);
    expect(read).not.toBeNull();
    expect(listHooks(read!)).toEqual([]);
  });
});
