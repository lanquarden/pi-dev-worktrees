/**
 * Tests for bash-dispatch emit behaviour: tool_execution_start captures the
 * original LLM command; tool_call emits ctx.ui.notify with method "bash-dispatch".
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../src/devcontainer.js", () => ({
  probeContainer: vi.fn().mockReturnValue(false),
  tailContainerLog: vi.fn(),
  readStartupOutcome: vi.fn().mockReturnValue({ outcome: null }),
  findDevcontainerConfig: vi.fn().mockReturnValue(null),
  generateOverrideJson: vi.fn(),
  startContainer: vi.fn(),
  stopContainer: vi.fn(),
  clearStartupLog: vi.fn(),
  containerLogPath: vi.fn().mockReturnValue("/tmp/dc.log"),
}));

vi.mock("../src/dashboard-ui.js", () => ({
  registerDashboardUi: vi.fn(),
  setDashboardProjectRoot: vi.fn(),
  invalidateDashboardUi: vi.fn(),
}));

vi.mock("../src/dashboard-events.js", () => ({
  emitWorkspaceCreated: vi.fn(),
  emitWorkspaceSwitched: vi.fn(),
  emitWorkspaceOff: vi.fn(),
  emitWorkspaceRemoved: vi.fn(),
  emitDevcontainerStarting: vi.fn(),
  emitDevcontainerReady: vi.fn(),
  emitDevcontainerStopped: vi.fn(),
  emitStateUpdate: vi.fn(),
}));

vi.mock("../src/session.js", () => ({
  state: {},
  loadState: vi.fn().mockReturnValue({}),
  saveState: vi.fn(),
}));

vi.mock("../src/worktrees.js", () => ({
  ensureWtpYml: vi.fn().mockReturnValue(false),
  createOrTargetWorktree: vi.fn(),
  readWtpYml: vi.fn().mockReturnValue(null),
  writeWtpYml: vi.fn(),
  listHooks: vi.fn().mockReturnValue([]),
  addCommandHook: vi.fn(),
  removeHook: vi.fn(),
  formatHook: vi.fn(),
  listWtpWorktrees: vi.fn().mockReturnValue([]),
}));

vi.mock("../src/config.js", () => ({
  loadPluginConfig: vi.fn().mockReturnValue({}),
  resolveWorktreeRoot: vi.fn().mockReturnValue(".pi/worktrees"),
  resolvePostCreateHooks: vi.fn().mockReturnValue([]),
}));

vi.mock("../src/rtk-compat.js", () => ({
  detectRtkConflicts: vi.fn().mockResolvedValue(undefined),
  probeContainerRtk: vi.fn().mockResolvedValue(false),
}));

vi.mock("node:child_process", () => ({
  execSync: vi.fn().mockImplementation((cmd: string) => {
    if (cmd.includes("rev-parse")) return "/project";
    if (cmd.includes("remote get-url")) return "";
    if (cmd.includes("wtp")) throw new Error("not found");
    return "";
  }),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readdirSync: vi.fn().mockReturnValue([]),
  statSync: vi.fn(),
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
  createLocalBashOperations: vi.fn().mockReturnValue({}),
}));

// ── Types ─────────────────────────────────────────────────────────────────────

type HandlerFn = (...args: any[]) => any;

interface MockPi {
  on: ReturnType<typeof vi.fn>;
  getCommands: ReturnType<typeof vi.fn>;
  getContext: ReturnType<typeof vi.fn>;
  registerCommand: ReturnType<typeof vi.fn>;
  registerTool: ReturnType<typeof vi.fn>;
  ui: {
    notify: ReturnType<typeof vi.fn>;
    setStatus: ReturnType<typeof vi.fn>;
  };
  // Map of event name → registered handlers
  _handlers: Map<string, HandlerFn[]>;
  // Helper to invoke all handlers for an event
  _emit: (event: string, ...args: any[]) => Promise<void>;
}

function createMockPi(): MockPi {
  const handlers = new Map<string, HandlerFn[]>();

  const mock: MockPi = {
    _handlers: handlers,
    on: vi.fn((event: string, handler: HandlerFn) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    }),
    getCommands: vi.fn().mockReturnValue([]),
    getContext: vi.fn().mockReturnValue(null),
    registerCommand: vi.fn(),
    registerTool: vi.fn(),
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
    },
    _emit: async (event: string, ...args: any[]) => {
      for (const handler of handlers.get(event) ?? []) {
        await handler(...args);
      }
    },
  };

  return mock;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMockCtx(notifySpy: ReturnType<typeof vi.fn>) {
  return {
    ui: {
      notify: notifySpy,
      setStatus: vi.fn(),
    },
    store: {
      get: vi.fn(),
      set: vi.fn(),
    },
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

let pi: MockPi;
let sessionNotify: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.clearAllMocks();
  pi = createMockPi();
  sessionNotify = vi.fn();

  // Import and register handlers (fresh module per test is handled by vi.mock hoisting)
  const { default: register } = await import("../src/index.js");
  register(pi as any);

  // Fire session_start — the ctx passed here is stored as sessionCtx by the implementation.
  // All tool_call notify calls go through sessionCtx.ui.notify (the bridge-patched version).
  await pi._emit("session_start", {}, makeMockCtx(sessionNotify));
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("bash-dispatch emit", () => {
  it("emits bash-dispatch with rtkRewritten=true for RTK rewrite + container routing", async () => {
    const ctx = makeMockCtx(vi.fn());

    // Simulate tool_execution_start (LLM's original command)
    await pi._emit("tool_execution_start", {
      toolName: "bash",
      toolCallId: "tc-1",
      args: { command: "grep foo" },
    });

    // Simulate tool_call (RTK has already rewritten command)
    await pi._emit(
      "tool_call",
      {
        toolName: "bash",
        toolCallId: "tc-1",
        input: { command: "grep foo . | rtk compress" },
      },
      ctx,
    );

    expect(sessionNotify).toHaveBeenCalledOnce();
    const [message, opts] = sessionNotify.mock.calls[0];
    expect(message).toBe("grep foo");
    expect(opts.toolCallId).toBe("tc-1");
    expect(opts.method).toBe("bash-dispatch");
    expect(opts.props.llmCommand).toBe("grep foo");
    expect(opts.props.rtkRewritten).toBe(true);
    expect(opts.props.rtkCommand).toBe("grep foo . | rtk compress");
  });

  it("emits bash-dispatch with rtkRewritten=false when no RTK rewrite, host routing", async () => {
    const ctx = makeMockCtx(vi.fn());

    await pi._emit("tool_execution_start", {
      toolName: "bash",
      toolCallId: "tc-2",
      args: { command: "ls -la" },
    });

    await pi._emit(
      "tool_call",
      {
        toolName: "bash",
        toolCallId: "tc-2",
        input: { command: "ls -la" },
      },
      ctx,
    );

    expect(sessionNotify).toHaveBeenCalledOnce();
    const [message, opts] = sessionNotify.mock.calls[0];
    expect(message).toBe("ls -la");
    expect(opts.method).toBe("bash-dispatch");
    expect(opts.props.rtkRewritten).toBe(false);
    expect(opts.props.rtkCommand).toBeUndefined();
    expect(opts.props.routing).toBe("host");
  });

  it("emits bash-dispatch with routing=host for HOST: prefix escape hatch", async () => {
    const ctx = makeMockCtx(vi.fn());

    await pi._emit("tool_execution_start", {
      toolName: "bash",
      toolCallId: "tc-3",
      args: { command: "HOST:ls" },
    });

    await pi._emit(
      "tool_call",
      {
        toolName: "bash",
        toolCallId: "tc-3",
        input: { command: "HOST:ls" },
      },
      ctx,
    );

    expect(sessionNotify).toHaveBeenCalledOnce();
    const [, opts] = sessionNotify.mock.calls[0];
    expect(opts.props.routing).toBe("host");
    expect(opts.props.rtkRewritten).toBe(false);
  });

  it("does NOT emit notify for non-bash tool calls", async () => {
    const ctx = makeMockCtx(vi.fn());

    await pi._emit("tool_execution_start", {
      toolName: "read_file",
      toolCallId: "tc-4",
      args: { path: "/some/file" },
    });

    await pi._emit(
      "tool_call",
      {
        toolName: "read_file",
        toolCallId: "tc-4",
        input: { path: "/some/file" },
      },
      ctx,
    );

    expect(sessionNotify).not.toHaveBeenCalled();
  });

  it("clears pendingLlmCommands after tool_call completes", async () => {
    const ctx = makeMockCtx(vi.fn());

    await pi._emit("tool_execution_start", {
      toolName: "bash",
      toolCallId: "tc-5",
      args: { command: "echo hello" },
    });

    // First call consumes the pending entry
    await pi._emit(
      "tool_call",
      {
        toolName: "bash",
        toolCallId: "tc-5",
        input: { command: "echo hello" },
      },
      ctx,
    );

    sessionNotify.mockClear();

    // Second call with same toolCallId — no pending entry, falls back to rtkCommand
    await pi._emit(
      "tool_call",
      {
        toolName: "bash",
        toolCallId: "tc-5",
        input: { command: "echo hello" },
      },
      ctx,
    );

    // Should still be called (with fallback), and rtkRewritten=false since llmCommand==rtkCommand
    expect(sessionNotify).toHaveBeenCalledOnce();
    const [, opts] = sessionNotify.mock.calls[0];
    expect(opts.props.rtkRewritten).toBe(false);
    expect(opts.props.llmCommand).toBe("echo hello");
  });

  it("falls back to rtkCommand as llmCommand when no tool_execution_start fired", async () => {
    const ctx = makeMockCtx(vi.fn());

    // No tool_execution_start — simulate missing entry
    await pi._emit(
      "tool_call",
      {
        toolName: "bash",
        toolCallId: "tc-6",
        input: { command: "ls -la" },
      },
      ctx,
    );

    expect(sessionNotify).toHaveBeenCalledOnce();
    const [message, opts] = sessionNotify.mock.calls[0];
    expect(message).toBe("ls -la");
    expect(opts.props.rtkRewritten).toBe(false);
    expect(opts.props.llmCommand).toBe("ls -la");
  });

  it("does NOT store entry for non-bash tool in tool_execution_start", async () => {
    // tool_execution_start for non-bash should not store anything
    await pi._emit("tool_execution_start", {
      toolName: "write_file",
      toolCallId: "tc-7",
      args: { command: "something" },
    });

    const ctx = makeMockCtx(vi.fn());

    // If we then fire a bash tool_call with same id, it should fall back
    await pi._emit(
      "tool_call",
      {
        toolName: "bash",
        toolCallId: "tc-7",
        input: { command: "ls" },
      },
      ctx,
    );

    expect(sessionNotify).toHaveBeenCalledOnce();
    const [, opts] = sessionNotify.mock.calls[0];
    // Falls back to rtkCommand since no entry was stored
    expect(opts.props.llmCommand).toBe("ls");
    expect(opts.props.rtkRewritten).toBe(false);
  });

  it("includes hasDevcontainer=false when no devcontainer in state", async () => {
    const ctx = makeMockCtx(vi.fn());

    await pi._emit("tool_execution_start", {
      toolName: "bash",
      toolCallId: "tc-8",
      args: { command: "pwd" },
    });

    await pi._emit(
      "tool_call",
      { toolName: "bash", toolCallId: "tc-8", input: { command: "pwd" } },
      ctx,
    );

    expect(sessionNotify).toHaveBeenCalledOnce();
    expect(sessionNotify.mock.calls[0][1].props.hasDevcontainer).toBe(false);
  });
});
