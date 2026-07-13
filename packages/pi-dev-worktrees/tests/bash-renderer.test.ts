import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  bashDispatchByToolCall,
  cleanupBashDispatch,
  createDispatchCallComponent,
  registerNativeBashRenderer,
  setBashDispatch,
} from "../src/bash-renderer.js";

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => `[${text.trim()}]`,
  bold: (text: string) => text,
} as any;

function context(id: string) {
  return {
    toolCallId: id,
    invalidate: vi.fn(),
    lastComponent: undefined,
    state: {},
    args: { command: "npm test" },
    cwd: "/repo",
    executionStarted: false,
    argsComplete: true,
    isPartial: false,
    expanded: false,
    showImages: false,
    isError: false,
  } as any;
}

beforeAll(() => initTheme(undefined, false));
afterEach(() => bashDispatchByToolCall.clear());

describe("native bash dispatch call rendering", () => {
  it("right-aligns DEV and RTK chips while keeping the LLM command left", () => {
    const ctx = context("dev");
    setBashDispatch("dev", {
      llmCommand: "npm test",
      routing: "container",
      containerId: "a1b2c3d4e5f67890",
      rtk: "applied",
      rtkRewritten: true,
      hasDevcontainer: true,
      managedWorktree: false,
    });
    const [line] = createDispatchCallComponent("npm test", theme, ctx).render(70);
    expect(line.startsWith("$ npm test")).toBe(true);
    expect(line).toContain("[DEV a1b2c3d4e5f6]");
    expect(line).toContain("[RTK]");
    expect(visibleWidth(line)).toBe(70);
  });

  it("restores the parent tool background before Box right padding", () => {
    const ansiTheme = {
      fg: (_color: string, text: string) => text,
      bg: (color: string, text: string) => {
        const code = color === "toolSuccessBg" ? "48;5;22" : "48;5;24";
        return `\u001b[${code}m${text}\u001b[49m`;
      },
      bold: (text: string) => text,
    } as any;
    const ctx = context("background");
    setBashDispatch("background", {
      llmCommand: "npm test",
      routing: "container",
      containerId: "abc123",
      rtk: "none",
      rtkRewritten: false,
      hasDevcontainer: true,
      managedWorktree: false,
    });

    const [line] = createDispatchCallComponent("npm test", ansiTheme, ctx).render(50);
    expect(visibleWidth(line)).toBe(50);
    expect(`${line} `).toContain("\u001b[49m\u001b[48;5;22m ");
  });

  it("renders HOST, error, fallback, and managed CWD chips", () => {
    const cases = [
      { id: "host", routing: "host" as const, rtk: "none" as const, hasDevcontainer: true, containerTargetingActive: true, managedWorktree: false, expected: "[HOST]" },
      { id: "error", routing: "error" as const, rtk: "none" as const, hasDevcontainer: true, managedWorktree: false, expected: "[error]" },
      { id: "fallback", routing: "container" as const, rtk: "fallback" as const, hasDevcontainer: true, managedWorktree: false, expected: "[RTK fallback]" },
      { id: "cwd", routing: "host" as const, rtk: "none" as const, hasDevcontainer: false, managedWorktree: true, cwd: "/repo/.pi/worktrees/x", expected: "[CWD /repo/.pi/worktrees/x]" },
    ];
    for (const item of cases) {
      setBashDispatch(item.id, {
        llmCommand: "cmd",
        routing: item.routing,
        rtk: item.rtk,
        rtkRewritten: item.rtk !== "none",
        hasDevcontainer: item.hasDevcontainer,
        containerTargetingActive: "containerTargetingActive" in item ? item.containerTargetingActive : undefined,
        managedWorktree: item.managedWorktree,
        cwd: item.cwd,
      });
      expect(createDispatchCallComponent("cmd", theme, context(item.id)).render(80).join("\n")).toContain(item.expected);
    }
  });

  it("omits CWD in external mode", () => {
    setBashDispatch("external", {
      llmCommand: "pwd",
      routing: "host",
      rtk: "none",
      rtkRewritten: false,
      hasDevcontainer: false,
      managedWorktree: false,
      cwd: "/externally/managed",
    });
    expect(createDispatchCallComponent("pwd", theme, context("external")).render(50).join("\n")).not.toContain("CWD");
  });

  it("moves chips to a right-aligned second line at narrow widths", () => {
    setBashDispatch("narrow", {
      llmCommand: "a very long command that cannot fit",
      routing: "container",
      containerId: "a1b2c3d4e5f6",
      rtk: "applied",
      rtkRewritten: true,
      hasDevcontainer: true,
      managedWorktree: false,
    });
    const lines = createDispatchCallComponent("cmd", theme, context("narrow")).render(28);
    expect(lines).toHaveLength(2);
    expect(lines[0].startsWith("$ ")).toBe(true);
    expect(lines.every((line) => visibleWidth(line) <= 28)).toBe(true);
    expect(lines[1].trimStart().startsWith("[DEV")).toBe(true);
  });

  it("keeps ordinary host-only calls chip-free", () => {
    setBashDispatch("plain", {
      llmCommand: "git status",
      routing: "host",
      rtk: "none",
      rtkRewritten: false,
      hasDevcontainer: false,
      managedWorktree: false,
    });
    expect(createDispatchCallComponent("git status", theme, context("plain")).render(50)).toEqual(["$ git status"]);
  });

  it("registers only in TUI mode and preserves a conflicting bash owner", () => {
    for (const mode of ["rpc", "json", "print"] as const) {
      const nonTuiPi = { registerTool: vi.fn(), getAllTools: vi.fn() };
      expect(registerNativeBashRenderer(nonTuiPi as any, "/repo", { mode } as any)).toBe(false);
      expect(nonTuiPi.registerTool).not.toHaveBeenCalled();
    }

    const notify = vi.fn();
    const conflictPi = {
      registerTool: vi.fn(),
      getAllTools: vi.fn().mockReturnValue([{
        name: "bash",
        sourceInfo: { source: "other-extension", path: "/extensions/other.ts" },
      }]),
    };
    expect(registerNativeBashRenderer(conflictPi as any, "/repo", {
      mode: "tui",
      ui: { notify },
    } as any)).toBe(false);
    expect(conflictPi.registerTool).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledOnce();
  });

  it("registers a stock-derived TUI wrapper and invalidates pending rows when dispatch arrives", () => {
    let registered: any;
    const pi = {
      getAllTools: vi.fn().mockReturnValue([{
        name: "bash",
        sourceInfo: { source: "builtin", path: "<builtin:bash>" },
      }]),
      registerTool: vi.fn((definition) => { registered = definition; }),
    };
    expect(registerNativeBashRenderer(pi as any, "/repo", {
      mode: "tui",
      ui: { notify: vi.fn() },
    } as any)).toBe(true);
    expect(typeof registered.execute).toBe("function");
    expect(typeof registered.renderResult).toBe("function");

    const ctx = context("redraw");
    registered.renderCall({ command: "npm test" }, theme, ctx);
    setBashDispatch("redraw", {
      llmCommand: "npm test",
      routing: "container",
      containerId: "abc123",
      rtk: "none",
      rtkRewritten: false,
      hasDevcontainer: true,
      containerTargetingActive: true,
      managedWorktree: false,
    });
    expect(ctx.invalidate).toHaveBeenCalledOnce();
    const rendered = registered.renderCall({ command: "wrapped" }, theme, ctx).render(60).join("\n");
    expect(rendered).toContain("$ npm test");
    expect(rendered).toContain("DEV abc123");
  });

  it("preserves dispatch rendering after metadata cleanup without falling back to the bash header", () => {
    let registered: any;
    const pi = {
      getAllTools: vi.fn().mockReturnValue([{
        name: "bash",
        sourceInfo: { source: "builtin", path: "<builtin:bash>" },
      }]),
      registerTool: vi.fn((definition) => { registered = definition; }),
    };
    registerNativeBashRenderer(pi as any, "/repo", {
      mode: "tui",
      ui: { notify: vi.fn() },
    } as any);

    const initialContext = context("lifecycle");
    const stockComponent = registered.renderCall({ command: "npm test" }, theme, initialContext);

    setBashDispatch("lifecycle", {
      llmCommand: "npm test",
      routing: "container",
      containerId: "abc123",
      rtk: "none",
      rtkRewritten: false,
      hasDevcontainer: true,
      containerTargetingActive: true,
      managedWorktree: false,
    });
    const dispatchContext = context("lifecycle");
    dispatchContext.lastComponent = stockComponent;
    const dispatchComponent = registered.renderCall({ command: "wrapped" }, theme, dispatchContext);
    expect(dispatchComponent.render(60).join("\n")).toContain("DEV abc123");

    cleanupBashDispatch("lifecycle");
    const finalContext = context("lifecycle");
    finalContext.lastComponent = dispatchComponent;
    const finalComponent = registered.renderCall({ command: "wrapped" }, theme, finalContext);

    expect(finalComponent).toBe(dispatchComponent);
    expect(finalComponent.render(60).join("\n")).toContain("DEV abc123");
  });

  it("cleans up only matching parallel dispatch metadata", () => {
    setBashDispatch("a", { llmCommand: "a", routing: "container", rtk: "none", rtkRewritten: false, hasDevcontainer: true, managedWorktree: false });
    setBashDispatch("b", { llmCommand: "b", routing: "host", rtk: "none", rtkRewritten: false, hasDevcontainer: true, managedWorktree: false });
    cleanupBashDispatch("b");
    expect(bashDispatchByToolCall.has("a")).toBe(true);
    expect(bashDispatchByToolCall.has("b")).toBe(false);
  });
});
