/**
 * tools.test.ts — Tests for the registered worktree and devcontainer tools,
 * and for the new /worktree sub-commands (status, remove, set alias).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("../src/devcontainer.js", () => ({
  probeContainer: vi.fn().mockReturnValue(false),
  tailContainerLog: vi.fn().mockReturnValue("log output"),
  readStartupOutcome: vi.fn().mockReturnValue({ outcome: null }),
  findDevcontainerConfig: vi.fn().mockReturnValue("/project/.devcontainer/devcontainer.json"),
  findContainerIdByLabel: vi.fn(),
  generateOverrideJson: vi.fn(),
  startContainer: vi.fn(),
  stopContainer: vi.fn().mockReturnValue({ stopped: true, containerId: "abc123" }),
  clearStartupLog: vi.fn(),
  containerLogPath: vi.fn().mockReturnValue("/project/.pi/devcontainer-up.log"),
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
  createOrTargetWorktree: vi.fn().mockReturnValue({ path: "/project/.pi/worktrees/feature/auth", hookOutput: "" }),
  readWtpYml: vi.fn().mockReturnValue(null),
  writeWtpYml: vi.fn(),
  listHooks: vi.fn().mockReturnValue([]),
  addCommandHook: vi.fn(),
  removeHook: vi.fn(),
  formatHook: vi.fn(),
  listWtpWorktrees: vi.fn().mockReturnValue([]),
  shellEscapeArg: (s: string) => `'${s.replace(/'/g, "'\\''")}'`,
}));

vi.mock("../src/config.js", () => ({
  loadPluginConfig: vi.fn().mockReturnValue({}),
  areWorktreesEnabled: vi.fn().mockReturnValue(true),
  isDevcontainerEnabled: vi.fn().mockReturnValue(true),
  resolveWorktreeRoot: vi.fn().mockReturnValue(".pi/worktrees"),
  resolvePostCreateHooks: vi.fn().mockReturnValue([]),
}));

vi.mock("../src/rtk-compat.js", () => ({
  detectRtkConflicts: vi.fn().mockResolvedValue(undefined),
  probeContainerRtk: vi.fn().mockResolvedValue(false),
}));

const execSyncMock = vi.fn().mockImplementation((cmd: string) => {
  if (cmd.includes("rev-parse")) return "/project";
  if (cmd.includes("remote get-url")) return "";
  if (cmd.includes("wtp --version")) return "wtp 2.0.0";
  if (cmd.includes("worktree list --porcelain")) return "worktree /project\nHEAD abc123\nbranch refs/heads/main\n";
  if (cmd.includes("git worktree prune")) return "";
  if (cmd.includes("git status --porcelain")) return "";
  if (cmd.includes("branch --list")) return "";
  if (cmd.includes("ls-remote")) return "";
  if (cmd.includes("wtp remove")) return "";
  if (cmd.includes("devcontainer --version")) return "0.50.0";
  return "";
});

vi.mock("node:child_process", () => ({
  execSync: execSyncMock,
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readdirSync: vi.fn().mockReturnValue([]),
  statSync: vi.fn().mockReturnValue({ mtimeMs: Date.now() }),
  readFileSync: vi.fn().mockReturnValue(""),
  writeFileSync: vi.fn(),
  appendFileSync: vi.fn(),
  openSync: vi.fn(),
  closeSync: vi.fn(),
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
  createLocalBashOperations: vi.fn().mockReturnValue({}),
}));

// ── Types ──────────────────────────────────────────────────────────────────

type HandlerFn = (...args: any[]) => any;

interface ToolDef {
  name: string;
  execute: (toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any) => Promise<any>;
}

interface CommandDef {
  description: string;
  handler: (args: string | undefined, ctx: any) => Promise<void>;
}

interface MockPi {
  on: ReturnType<typeof vi.fn>;
  getCommands: ReturnType<typeof vi.fn>;
  getContext: ReturnType<typeof vi.fn>;
  getActiveTools: ReturnType<typeof vi.fn>;
  setActiveTools: ReturnType<typeof vi.fn>;
  registerCommand: ReturnType<typeof vi.fn>;
  registerTool: ReturnType<typeof vi.fn>;
  ui: { notify: ReturnType<typeof vi.fn>; setStatus: ReturnType<typeof vi.fn> };
  events: { emit: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> };
  _handlers: Map<string, HandlerFn[]>;
  _emit: (event: string, ...args: any[]) => Promise<void>;
  _tools: Map<string, ToolDef>;
  _commands: Map<string, CommandDef>;
}

function createMockPi(): MockPi {
  const handlers = new Map<string, HandlerFn[]>();
  const tools = new Map<string, ToolDef>();
  const commands = new Map<string, CommandDef>();

  const mock: MockPi = {
    _handlers: handlers,
    _tools: tools,
    _commands: commands,
    on: vi.fn((event: string, handler: HandlerFn) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    }),
    getCommands: vi.fn().mockReturnValue([]),
    getContext: vi.fn().mockReturnValue(null),
    getActiveTools: vi.fn().mockReturnValue(["bash", "read", "worktree", "devcontainer"]),
    setActiveTools: vi.fn(),
    registerCommand: vi.fn((name: string, def: CommandDef) => {
      commands.set(name, def);
    }),
    registerTool: vi.fn((def: ToolDef) => {
      tools.set(def.name, def);
    }),
    ui: { notify: vi.fn(), setStatus: vi.fn() },
    events: { emit: vi.fn(), on: vi.fn() },
    _emit: async (event: string, ...args: any[]) => {
      for (const handler of handlers.get(event) ?? []) {
        await handler(...args);
      }
    },
  };
  return mock;
}

function makeMockCtx() {
  return {
    cwd: "/project",
    mode: "rpc",
    hasUI: true,
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
      confirm: vi.fn().mockResolvedValue(true),
      input: vi.fn().mockResolvedValue(""),
    },
    store: { get: vi.fn(), set: vi.fn() },
    sessionManager: { getEntries: vi.fn().mockReturnValue([]), getBranch: vi.fn().mockReturnValue([]) },
  };
}

// ── Setup ──────────────────────────────────────────────────────────────────

let pi: MockPi;

beforeEach(async () => {
  vi.clearAllMocks();
  const config = await import("../src/config.js");
  const session = await import("../src/session.js");
  vi.mocked(config.areWorktreesEnabled).mockReturnValue(true);
  vi.mocked(config.isDevcontainerEnabled).mockReturnValue(true);
  vi.mocked(config.loadPluginConfig).mockReturnValue({});
  vi.mocked(session.loadState).mockReturnValue({});
  const devcontainer = await import("../src/devcontainer.js");
  vi.mocked(devcontainer.probeContainer).mockReturnValue(false);
  vi.mocked(devcontainer.readStartupOutcome).mockReturnValue({ outcome: null });
  vi.mocked(devcontainer.findDevcontainerConfig).mockReturnValue("/project/.devcontainer/devcontainer.json");
  vi.mocked(devcontainer.stopContainer).mockReturnValue({ stopped: true, containerId: "abc123" });
  execSyncMock.mockImplementation((cmd: string) => {
    if (cmd.includes("rev-parse")) return "/project";
    if (cmd.includes("remote get-url")) return "";
    if (cmd.includes("wtp --version")) return "wtp 2.0.0";
    if (cmd.includes("worktree list --porcelain")) return "worktree /project\nHEAD abc123\nbranch refs/heads/main\n";
    if (cmd.includes("git worktree prune")) return "";
    if (cmd.includes("git status --porcelain")) return "";
    if (cmd.includes("branch --list")) return "";
    if (cmd.includes("ls-remote")) return "";
    if (cmd.includes("wtp remove")) return "";
    if (cmd.includes("devcontainer --version")) return "0.50.0";
    return "";
  });

  pi = createMockPi();
  const { default: register } = await import("../src/index.js");
  register(pi as any);
  await pi._emit("session_start", {}, makeMockCtx());
});

// ── worktree tool ──────────────────────────────────────────────────────────

describe("worktree tool", () => {
  it("is registered", () => {
    expect(pi._tools.has("worktree")).toBe(true);
  });

  it("action=set without branch returns error", async () => {
    const tool = pi._tools.get("worktree")!;
    const result = await tool.execute("1", { action: "set" }, null, null, makeMockCtx());
    expect(result.content[0].text).toMatch(/branch.*required/i);
    expect(result.details.ok).toBe(false);
  });

  it("action=remove without branch returns error", async () => {
    const tool = pi._tools.get("worktree")!;
    const result = await tool.execute("1", { action: "remove" }, null, null, makeMockCtx());
    expect(result.content[0].text).toMatch(/branch.*required/i);
    expect(result.details.ok).toBe(false);
  });

  it("action=set with branch succeeds", async () => {
    const { existsSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(false);

    const tool = pi._tools.get("worktree")!;
    const result = await tool.execute("1", { action: "set", branch: "feature/auth" }, null, null, makeMockCtx());
    expect(result.details.ok).toBe(true);
    expect(result.content[0].text).toMatch(/worktree/i);
  });

  it("action=off returns ok", async () => {
    const tool = pi._tools.get("worktree")!;
    const result = await tool.execute("1", { action: "off" }, null, null, makeMockCtx());
    expect(result.details.ok).toBe(true);
    expect(result.content[0].text).toMatch(/off/i);
  });

  it("action=prune calls git worktree prune and returns ok", async () => {
    const tool = pi._tools.get("worktree")!;
    const result = await tool.execute("1", { action: "prune" }, null, null, makeMockCtx());
    expect(result.details.ok).toBe(true);
    expect(execSyncMock).toHaveBeenCalledWith(
      expect.stringContaining("git worktree prune"),
      expect.anything(),
    );
  });

  it("action=status returns snapshot text", async () => {
    const tool = pi._tools.get("worktree")!;
    const result = await tool.execute("1", { action: "status" }, null, null, makeMockCtx());
    expect(result.details.ok).toBe(true);
    expect(result.content[0].text).toMatch(/worktree/i);
  });

  it("action=remove with branch calls wtp remove", async () => {
    const tool = pi._tools.get("worktree")!;
    const result = await tool.execute("1", { action: "remove", branch: "feature/auth" }, null, null, makeMockCtx());
    expect(result.details.ok).toBe(true);
    expect(execSyncMock).toHaveBeenCalledWith(
      expect.stringContaining("wtp remove"),
      expect.anything(),
    );
  });

  it("action=remove calls git worktree prune after removal", async () => {
    const tool = pi._tools.get("worktree")!;
    await tool.execute("1", { action: "remove", branch: "feature/auth" }, null, null, makeMockCtx());
    expect(execSyncMock).toHaveBeenCalledWith(
      expect.stringContaining("git worktree prune"),
      expect.anything(),
    );
  });

  it("action=remove force-removes a dirty worktree", async () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.includes("rev-parse")) return "/project";
      if (cmd.includes("wtp --version")) return "wtp 2.0.0";
      if (cmd.includes("worktree list --porcelain")) return "worktree /project\n";
      if (cmd.includes("git status --porcelain")) return "M some-file.ts"; // dirty
      if (cmd.includes("wtp remove")) return "";
      if (cmd.includes("git worktree prune")) return "";
      return "";
    });

    const tool = pi._tools.get("worktree")!;
    await tool.execute("1", { action: "remove", branch: "feature/dirty" }, null, null, makeMockCtx());
    expect(execSyncMock).toHaveBeenCalledWith(
      expect.stringContaining("--force"),
      expect.anything(),
    );
  });
});

// ── devcontainer tool ──────────────────────────────────────────────────────

describe("devcontainer tool", () => {
  it("is registered", () => {
    expect(pi._tools.has("devcontainer")).toBe(true);
  });

  it("action=on returns ok", async () => {
    const tool = pi._tools.get("devcontainer")!;
    const result = await tool.execute("1", { action: "on" }, null, null, makeMockCtx());
    expect(result.details.ok).toBe(true);
    expect(result.content[0].text).toMatch(/container/i);
  });

  it("action=off returns ok", async () => {
    const tool = pi._tools.get("devcontainer")!;
    const result = await tool.execute("1", { action: "off" }, null, null, makeMockCtx());
    expect(result.details.ok).toBe(true);
  });

  it("action=rebuild returns ok", async () => {
    const tool = pi._tools.get("devcontainer")!;
    const result = await tool.execute("1", { action: "rebuild" }, null, null, makeMockCtx());
    expect(result.details.ok).toBe(true);
  });

  it("action=logs returns log tail", async () => {
    const { tailContainerLog } = await import("../src/devcontainer.js");
    vi.mocked(tailContainerLog).mockReturnValue("container started OK");

    const tool = pi._tools.get("devcontainer")!;
    const result = await tool.execute("1", { action: "logs" }, null, null, makeMockCtx());
    expect(result.details.ok).toBe(true);
    expect(result.content[0].text).toBe("container started OK");
  });

  it("action=logs returns fallback message when no log exists", async () => {
    const { tailContainerLog } = await import("../src/devcontainer.js");
    vi.mocked(tailContainerLog).mockReturnValue("");

    const tool = pi._tools.get("devcontainer")!;
    const result = await tool.execute("1", { action: "logs" }, null, null, makeMockCtx());
    expect(result.details.ok).toBe(true);
    expect(result.content[0].text).toMatch(/no startup log/i);
  });

  it("action=on fails gracefully when devcontainer CLI is missing", async () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.includes("rev-parse")) return "/project";
      if (cmd.includes("remote get-url")) return "";
      if (cmd.includes("devcontainer --version")) throw new Error("not found");
      return "";
    });

    // Re-register with updated mock
    pi = createMockPi();
    const { default: register } = await import("../src/index.js");
    register(pi as any);
    await pi._emit("session_start", {}, makeMockCtx());

    const tool = pi._tools.get("devcontainer")!;
    const result = await tool.execute("1", { action: "on" }, null, null, makeMockCtx());
    expect(result.details.ok).toBe(false);
    expect(result.content[0].text).toMatch(/not found/i);
  });

  it("action=on reuses running container when probe succeeds", async () => {
    const { probeContainer, readStartupOutcome } = await import("../src/devcontainer.js");
    vi.mocked(probeContainer).mockReturnValueOnce(true);
    vi.mocked(readStartupOutcome).mockReturnValueOnce({
      outcome: "success",
      containerId: "reused-container-id",
      remoteWorkspaceFolder: "/workspaces/myrepo",
    });

    const tool = pi._tools.get("devcontainer")!;
    const result = await tool.execute("1", { action: "on" }, null, null, makeMockCtx());
    expect(result.details.ok).toBe(true);
    expect(result.content[0].text).toMatch(/reusing running container/i);
    // Should NOT call startContainer when reusing
    const { startContainer } = await import("../src/devcontainer.js");
    expect(startContainer).not.toHaveBeenCalled();
  });

  it("action=stop calls saveState and emits devcontainer stopped", async () => {
    const { saveState, state } = await import("../src/session.js");
    const { emitDevcontainerStopped, emitStateUpdate } = await import("../src/dashboard-events.js");

    // Simulate an active devcontainer
    (state as any).devcontainer = {
      enabled: true,
      workspace: "/project",
      starting: false,
      containerId: "abc123",
    };

    const tool = pi._tools.get("devcontainer")!;
    const result = await tool.execute("1", { action: "stop" }, null, null, makeMockCtx());

    expect(result.details.ok).toBe(true);
    expect(result.content[0].text).toMatch(/stopped/i);
    expect(saveState).toHaveBeenCalled();
    expect(emitDevcontainerStopped).toHaveBeenCalled();
    expect(emitStateUpdate).toHaveBeenCalled();
    // State should be disabled after stop
    expect((state as any).devcontainer.enabled).toBe(false);
    expect((state as any).devcontainer.starting).toBe(false);
    expect((state as any).devcontainer.containerId).toBeUndefined();
    // Log should be cleared
    const { clearStartupLog } = await import("../src/devcontainer.js");
    expect(clearStartupLog).toHaveBeenCalled();
  });

  it("action=stop returns error when stopContainer fails", async () => {
    const { stopContainer } = await import("../src/devcontainer.js");
    vi.mocked(stopContainer).mockReturnValueOnce({ stopped: false });

    const tool = pi._tools.get("devcontainer")!;
    const result = await tool.execute("1", { action: "stop" }, null, null, makeMockCtx());
    expect(result.details.ok).toBe(false);
    expect(result.content[0].text).toMatch(/failed/i);
  });
});

// ── /devcontainer command: stop sub-command ──────────────────────────────

describe("/devcontainer command — stop sub-command", () => {
  it("saves state and emits devcontainer stopped on success", async () => {
    const { saveState, state } = await import("../src/session.js");
    const { emitDevcontainerStopped, emitStateUpdate } = await import("../src/dashboard-events.js");

    (state as any).devcontainer = {
      enabled: true,
      workspace: "/project",
      starting: false,
      containerId: "abc123",
    };

    const cmd = pi._commands.get("devcontainer")!;
    const ctx = makeMockCtx();
    await cmd.handler("stop", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("stopped"),
      "info",
    );
    expect(saveState).toHaveBeenCalled();
    expect(emitDevcontainerStopped).toHaveBeenCalled();
    expect(emitStateUpdate).toHaveBeenCalled();
    expect((state as any).devcontainer.enabled).toBe(false);
  });

  it("notifies warning when stopContainer fails", async () => {
    const { stopContainer } = await import("../src/devcontainer.js");
    vi.mocked(stopContainer).mockReturnValueOnce({ stopped: false });

    const cmd = pi._commands.get("devcontainer")!;
    const ctx = makeMockCtx();
    await cmd.handler("stop", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Failed"),
      "warning",
    );
  });
});

// ── /worktree command: new sub-commands ───────────────────────────────────

describe("/worktree command — status sub-command", () => {
  it("notifies with snapshot text", async () => {
    const cmd = pi._commands.get("worktree")!;
    const ctx = makeMockCtx();
    await cmd.handler("status", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Worktrees"),
      "info",
    );
  });
});

describe("/worktree command — remove sub-command", () => {
  it("prompts before removing", async () => {
    const cmd = pi._commands.get("worktree")!;
    const ctx = makeMockCtx();
    await cmd.handler("remove feature/auth", ctx);
    expect(ctx.ui.confirm).toHaveBeenCalled();
  });

  it("removes when confirmed", async () => {
    const cmd = pi._commands.get("worktree")!;
    const ctx = makeMockCtx();
    vi.mocked(ctx.ui.confirm).mockResolvedValue(true);
    await cmd.handler("remove feature/auth", ctx);
    expect(execSyncMock).toHaveBeenCalledWith(
      expect.stringContaining("wtp remove"),
      expect.anything(),
    );
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("feature/auth"),
      "info",
    );
  });

  it("cancels without removing when user declines", async () => {
    const cmd = pi._commands.get("worktree")!;
    const ctx = makeMockCtx();
    vi.mocked(ctx.ui.confirm).mockResolvedValue(false);
    await cmd.handler("remove feature/auth", ctx);
    expect(execSyncMock).not.toHaveBeenCalledWith(
      expect.stringContaining("wtp remove"),
      expect.anything(),
    );
    expect(ctx.ui.notify).toHaveBeenCalledWith("Cancelled", "info");
  });

  it("shows usage when branch is missing", async () => {
    const cmd = pi._commands.get("worktree")!;
    const ctx = makeMockCtx();
    await cmd.handler("remove", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Usage"),
      "info",
    );
  });
});

describe("/worktree command — set alias", () => {
  it("set <branch> behaves identically to bare <branch>", async () => {
    const cmd = pi._commands.get("worktree")!;

    const ctx1 = makeMockCtx();
    await cmd.handler("feature/auth", ctx1);

    const ctx2 = makeMockCtx();
    await cmd.handler("set feature/auth", ctx2);

    // Both should have called notify with a worktree message (ok or error)
    expect(ctx1.ui.notify).toHaveBeenCalled();
    expect(ctx2.ui.notify).toHaveBeenCalled();
    // Both should produce the same result kind
    const msg1: string = vi.mocked(ctx1.ui.notify).mock.calls[0][0];
    const msg2: string = vi.mocked(ctx2.ui.notify).mock.calls[0][0];
    expect(msg1).toBe(msg2);
  });
});

// ── Removed commands ──────────────────────────────────────────────────────

describe("removed commands", () => {
  it("workspaces command is not registered", () => {
    expect(pi._commands.has("workspaces")).toBe(false);
  });

  it("workspace-cleanup command is not registered", () => {
    expect(pi._commands.has("workspace-cleanup")).toBe(false);
  });
});

// ── capability gating and external-worktree mode ────────────────────────────

describe("capability gating", () => {
  it("external mode clears stale worktree state, skips wtp init, and removes the tool", async () => {
    const config = await import("../src/config.js");
    const session = await import("../src/session.js");
    const worktrees = await import("../src/worktrees.js");
    vi.mocked(config.areWorktreesEnabled).mockReturnValue(false);
    vi.mocked(config.isDevcontainerEnabled).mockReturnValue(true);
    vi.mocked(session.loadState).mockReturnValueOnce({ worktree: { branch: "stale", path: "/old/wt" } });
    vi.mocked(worktrees.ensureWtpYml).mockClear();

    const externalPi = createMockPi();
    const { default: register } = await import("../src/index.js");
    register(externalPi as any);
    await externalPi._emit("session_start", {}, makeMockCtx());

    expect((session.state as any).worktree).toBeUndefined();
    expect(session.saveState).toHaveBeenCalled();
    expect(worktrees.ensureWtpYml).not.toHaveBeenCalled();
    expect(externalPi.setActiveTools).toHaveBeenCalledWith(["bash", "read", "devcontainer"]);
  });

  it("makes every external-mode worktree command/tool invocation explanatory and non-mutating", async () => {
    const config = await import("../src/config.js");
    vi.mocked(config.areWorktreesEnabled).mockReturnValue(false);
    const externalPi = createMockPi();
    const { default: register } = await import("../src/index.js");
    register(externalPi as any);
    await externalPi._emit("session_start", {}, makeMockCtx());
    execSyncMock.mockClear();

    const toolResult = await externalPi._tools.get("worktree")!.execute("x", { action: "prune" }, null, null, makeMockCtx());
    expect(toolResult.content[0].text).toMatch(/externally managed/i);
    const ctx = makeMockCtx();
    await externalPi._commands.get("worktree")!.handler("set feature/x", ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringMatching(/externally managed/i), "info");
    expect(execSyncMock).not.toHaveBeenCalled();
  });

  it("external mode keeps relative file-tool paths untouched despite stale restored state", async () => {
    const config = await import("../src/config.js");
    const session = await import("../src/session.js");
    vi.mocked(config.areWorktreesEnabled).mockReturnValue(false);
    vi.mocked(session.loadState).mockReturnValueOnce({ worktree: { branch: "stale", path: "/old/wt" } });
    const externalPi = createMockPi();
    const { default: register } = await import("../src/index.js");
    register(externalPi as any);
    await externalPi._emit("session_start", {}, makeMockCtx());
    const event = { toolName: "read", toolCallId: "r", input: { path: "README.md" } };
    await externalPi._emit("tool_call", event, makeMockCtx());
    expect(event.input.path).toBe("README.md");
  });

  it("disabled devcontainers clear restored state without lifecycle calls and remove the tool", async () => {
    const config = await import("../src/config.js");
    const session = await import("../src/session.js");
    const devcontainer = await import("../src/devcontainer.js");
    vi.mocked(config.isDevcontainerEnabled).mockReturnValue(false);
    vi.mocked(session.loadState).mockReturnValueOnce({ devcontainer: { enabled: true, workspace: "/old" } });
    const disabledPi = createMockPi();
    const { default: register } = await import("../src/index.js");
    register(disabledPi as any);
    await disabledPi._emit("session_start", {}, makeMockCtx());

    expect((session.state as any).devcontainer).toBeUndefined();
    expect(devcontainer.stopContainer).not.toHaveBeenCalled();
    expect(devcontainer.probeContainer).not.toHaveBeenCalled();
    expect(devcontainer.startContainer).not.toHaveBeenCalled();
    expect(disabledPi.setActiveTools).toHaveBeenCalledWith(["bash", "read", "worktree"]);
    const result = await disabledPi._tools.get("devcontainer")!.execute("x", { action: "on" }, null, null, makeMockCtx());
    expect(result.content[0].text).toMatch(/disabled by config/i);
  });

  it("roots external-mode devcontainer operations at the exact session cwd below Git root", async () => {
    const config = await import("../src/config.js");
    const devcontainer = await import("../src/devcontainer.js");
    vi.mocked(config.areWorktreesEnabled).mockReturnValue(false);
    vi.mocked(config.isDevcontainerEnabled).mockReturnValue(true);
    const externalPi = createMockPi();
    const { default: register } = await import("../src/index.js");
    register(externalPi as any);
    const ctx = makeMockCtx();
    ctx.cwd = "/project/packages/api";
    await externalPi._emit("session_start", {}, ctx);
    const result = await externalPi._tools.get("devcontainer")!.execute("x", { action: "on" }, null, null, ctx);
    expect(result.details.ok).toBe(true);
    expect(devcontainer.findDevcontainerConfig).toHaveBeenCalledWith("/project/packages/api");
    expect(devcontainer.generateOverrideJson).toHaveBeenCalledWith(
      "/project/packages/api",
      expect.any(String),
      true,
      "/project",
    );
    expect(devcontainer.startContainer).toHaveBeenCalledWith(
      "/project/packages/api",
      true,
      false,
      "/project",
    );
  });
});


describe("restored devcontainer reconciliation", () => {
  it("retargets a differently rooted restored container without stopping the old root", async () => {
    const config = await import("../src/config.js");
    const session = await import("../src/session.js");
    const devcontainer = await import("../src/devcontainer.js");
    vi.mocked(config.areWorktreesEnabled).mockReturnValue(false);
    vi.mocked(session.loadState).mockReturnValueOnce({
      devcontainer: { enabled: true, workspace: "/project/old", starting: false },
    });
    vi.mocked(devcontainer.stopContainer).mockClear();
    vi.mocked(devcontainer.startContainer).mockClear();
    const p = createMockPi();
    const { default: register } = await import("../src/index.js");
    register(p as any);
    const ctx = makeMockCtx();
    ctx.cwd = "/project/current";
    await p._emit("session_start", {}, ctx);

    expect(devcontainer.stopContainer).not.toHaveBeenCalled();
    expect(devcontainer.startContainer).toHaveBeenCalledWith("/project/current", false, false, "/project");
    expect((session.state as any).devcontainer).toMatchObject({
      enabled: true,
      workspace: "/project/current",
      starting: true,
    });
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringMatching(/current session cwd/i), "info");
  });

  it("stops and recreates a current-root container with a mismatched mount", async () => {
    const config = await import("../src/config.js");
    const session = await import("../src/session.js");
    const devcontainer = await import("../src/devcontainer.js");
    vi.mocked(config.areWorktreesEnabled).mockReturnValue(false);
    vi.mocked(session.loadState).mockReturnValueOnce({
      devcontainer: {
        enabled: true,
        workspace: "/project/current",
        starting: false,
        remoteWorkspaceFolder: "/workspaces/wrong",
      },
    });
    vi.mocked(devcontainer.stopContainer).mockClear();
    vi.mocked(devcontainer.startContainer).mockClear();
    const p = createMockPi();
    const { default: register } = await import("../src/index.js");
    register(p as any);
    const ctx = makeMockCtx();
    ctx.cwd = "/project/current";
    await p._emit("session_start", {}, ctx);

    expect(devcontainer.stopContainer).toHaveBeenCalledWith("/project/current");
    expect(devcontainer.generateOverrideJson).toHaveBeenCalledWith(
      "/project/current", expect.any(String), true, "/project",
    );
    expect(devcontainer.startContainer).toHaveBeenCalledWith("/project/current", true, false, "/project");
  });

  it("restarts aligned restored targeting when the current-root container is unresponsive", async () => {
    const config = await import("../src/config.js");
    const session = await import("../src/session.js");
    const devcontainer = await import("../src/devcontainer.js");
    vi.mocked(config.areWorktreesEnabled).mockReturnValue(false);
    vi.mocked(session.loadState).mockReturnValueOnce({
      devcontainer: { enabled: true, workspace: "/project/current", starting: false, remoteWorkspaceFolder: "/project/current" },
    });
    vi.mocked(devcontainer.probeContainer).mockReturnValue(false);
    vi.mocked(devcontainer.stopContainer).mockClear();
    vi.mocked(devcontainer.startContainer).mockClear();
    const p = createMockPi();
    const { default: register } = await import("../src/index.js");
    register(p as any);
    const ctx = makeMockCtx();
    ctx.cwd = "/project/current";
    await p._emit("session_start", {}, ctx);

    expect(devcontainer.stopContainer).toHaveBeenCalledWith("/project/current");
    expect(devcontainer.startContainer).toHaveBeenCalledWith("/project/current", true, false, "/project");
    expect((session.state as any).devcontainer).toMatchObject({ workspace: "/project/current", starting: true });
  });

  it("disables reconciled targeting with the normal diagnostic when config is missing", async () => {
    const config = await import("../src/config.js");
    const session = await import("../src/session.js");
    const devcontainer = await import("../src/devcontainer.js");
    vi.mocked(config.areWorktreesEnabled).mockReturnValue(false);
    vi.mocked(session.loadState).mockReturnValueOnce({
      devcontainer: { enabled: true, workspace: "/project/old", starting: false },
    });
    vi.mocked(devcontainer.findDevcontainerConfig).mockReturnValue(null);
    vi.mocked(devcontainer.startContainer).mockClear();
    const p = createMockPi();
    const { default: register } = await import("../src/index.js");
    register(p as any);
    const ctx = makeMockCtx();
    ctx.cwd = "/project/current";
    await p._emit("session_start", {}, ctx);

    expect((session.state as any).devcontainer).toBeUndefined();
    expect(devcontainer.startContainer).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringMatching(/No \.devcontainer/i), "warning");
  });
});
