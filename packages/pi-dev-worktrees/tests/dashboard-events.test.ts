/**
 * Tests for openspec:directory_hint emission in dashboard-events.ts.
 * Validates that emitWorkspaceCreated and emitWorkspaceSwitched emit
 * openspec:directory_hint with { path } alongside the existing workspace
 * events, and that the off-variant does NOT emit the hint.
 * See change: openspec-directory-hint.
 */

import { describe, it, expect, vi } from "vitest";
import {
  emitWorkspaceCreated,
  emitWorkspaceSwitched,
} from "../src/dashboard-events.js";

function makePi() {
  const emitted: Array<{ event: string; data: unknown }> = [];
  return {
    events: {
      emit: vi.fn((event: string, data: unknown) => {
        emitted.push({ event, data });
      }),
      on: vi.fn(),
    },
    emitted,
  };
}

describe("dashboard-events: openspec:directory_hint emission", () => {
  it("emitWorkspaceCreated emits openspec:directory_hint with path", () => {
    const pi = makePi();
    emitWorkspaceCreated(pi as any, "feature/foo", "/repo/.pi/worktrees/feature/foo", "/repo");

    const hint = pi.emitted.find((e) => e.event === "openspec:directory_hint");
    expect(hint).toBeDefined();
    expect(hint?.data).toEqual({ path: "/repo/.pi/worktrees/feature/foo" });
  });

  it("emitWorkspaceCreated still emits workspace-created event", () => {
    const pi = makePi();
    emitWorkspaceCreated(pi as any, "feature/foo", "/repo/.pi/worktrees/feature/foo", "/repo");

    const created = pi.emitted.find((e) => e.event === "pi-dev-worktrees:workspace-created");
    expect(created).toBeDefined();
  });

  it("emitWorkspaceSwitched with valid branch+path emits openspec:directory_hint", () => {
    const pi = makePi();
    emitWorkspaceSwitched(pi as any, "feature/bar", "/repo/.pi/worktrees/feature/bar", "/repo");

    const hint = pi.emitted.find((e) => e.event === "openspec:directory_hint");
    expect(hint).toBeDefined();
    expect(hint?.data).toEqual({ path: "/repo/.pi/worktrees/feature/bar" });
  });

  it("emitWorkspaceSwitched with valid branch+path still emits workspace-switched event", () => {
    const pi = makePi();
    emitWorkspaceSwitched(pi as any, "feature/bar", "/repo/.pi/worktrees/feature/bar", "/repo");

    const switched = pi.emitted.find((e) => e.event === "pi-dev-worktrees:workspace-switched");
    expect(switched).toBeDefined();
  });

  it("emitWorkspaceSwitched off-variant (null branch/path) does NOT emit openspec:directory_hint", () => {
    const pi = makePi();
    emitWorkspaceSwitched(pi as any, null, null, "/repo");

    const hint = pi.emitted.find((e) => e.event === "openspec:directory_hint");
    expect(hint).toBeUndefined();
  });

  it("openspec:directory_hint payload contains only path", () => {
    const pi = makePi();
    emitWorkspaceCreated(pi as any, "feature/foo", "/repo/.pi/worktrees/feature/foo", "/repo");

    const hint = pi.emitted.find((e) => e.event === "openspec:directory_hint");
    expect(Object.keys(hint?.data as object)).toEqual(["path"]);
  });
});
