import React from "react";
import type { ToolRendererProps } from "@blackbelt-technology/dashboard-plugin-runtime";

interface BashDispatchData {
  llmCommand?: string;
  rtkRewritten?: boolean;
  rtkCommand?: string;
  routing?: "host" | "container" | "error";
  containerId?: string;
  cwd?: string;
  hasDevcontainer?: boolean;
}

function extractDispatchData(args?: Record<string, unknown>): BashDispatchData | undefined {
  return (args as any)?._pluginData?.["pi-dev-worktrees:bash-dispatch"] as BashDispatchData | undefined;
}

/**
 * Strip a leading `cd <path> && ` (or `; `) preamble from a command string
 * for display purposes. Also strips leading `export VAR=value; ` blocks.
 * Returns the bare command and the extracted cwd (if any).
 */
function parseDisplayCommand(cmd: string): { display: string; cwd: string | null } {
  let s = cmd.trim();
  // Strip leading `export VAR=value; ` blocks
  s = s.replace(/^(?:export\s+)?\w+=[^;\n]*;\s*/g, "");
  // Match leading `cd <path> && ` or `cd <path>; `
  const cdMatch = s.match(/^cd\s+(\S+)\s*(?:&&|;)\s*/);
  if (cdMatch) {
    return { display: s.slice(cdMatch[0].length).trim(), cwd: cdMatch[1] };
  }
  return { display: s, cwd: null };
}

function DispatchChips({ dispatch }: { dispatch: BashDispatchData }) {
  return (
    <span className="flex items-center gap-1.5 shrink-0">
      {dispatch.cwd && (
        <span
          className="inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-sans bg-zinc-400/15 text-zinc-400"
          title={dispatch.cwd}
        >
          CWD
        </span>
      )}
      {dispatch.rtkRewritten && (
        <span
          className="inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-sans bg-amber-400/15 text-amber-400"
          title={dispatch.rtkCommand}
        >
          RTK
        </span>
      )}
      {dispatch.routing === "container" && (
        <span className="inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-sans bg-blue-400/15 text-blue-400">
          DEV
        </span>
      )}
      {dispatch.routing === "host" && dispatch.hasDevcontainer && (
        <span className="inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-sans bg-violet-400/15 text-violet-400">
          HOST
        </span>
      )}
      {dispatch.routing === "error" && (
        <span className="inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-sans bg-red-400/15 text-red-400">
          error
        </span>
      )}
    </span>
  );
}

/** Summary override for the collapsed tool header row */
export function bashDispatchSummary(args?: Record<string, unknown>): string {
  const dispatch = extractDispatchData(args);
  const raw = dispatch?.llmCommand ?? (args?.command as string) ?? "command";
  const { display } = parseDisplayCommand(raw);
  return `$ ${display.slice(0, 80)}`;
}

/** Header chips function for registerToolRenderer opts */
export function renderBashDispatchChips(args?: Record<string, unknown>): React.ReactNode {
  const dispatch = extractDispatchData(args);
  const rawCommand = dispatch?.llmCommand ?? (args?.command as string);
  const parsedCwd = rawCommand ? parseDisplayCommand(rawCommand).cwd : null;
  const effectiveCwd = dispatch?.cwd ?? parsedCwd ?? undefined;
  const augmented = dispatch
    ? { ...dispatch, cwd: effectiveCwd }
    : effectiveCwd
    ? ({ cwd: effectiveCwd } as BashDispatchData)
    : null;
  if (!augmented) return null;
  return <DispatchChips dispatch={augmented} />;
}

/** Detail rows showing CWD / RTK rewrite / container target */
function DispatchDetail({ dispatch }: { dispatch: BashDispatchData }) {
  const hasCwd = Boolean(dispatch.cwd);
  const hasRtk = dispatch.rtkRewritten && dispatch.rtkCommand;
  const hasDev = dispatch.routing === "container";

  if (!hasCwd && !hasRtk && !hasDev) return null;

  return (
    <div className="flex flex-col gap-0.5 mt-1 text-[10px] text-[var(--text-muted)]">
      {hasCwd && (
        <span className="flex items-center gap-1">
          <span className="inline-flex items-center px-1 py-[0.5px] rounded font-medium bg-zinc-400/15 text-zinc-400">
            CWD
          </span>
          <span className="font-mono truncate">{dispatch.cwd}</span>
        </span>
      )}
      {hasRtk && (
        <span className="flex items-center gap-1">
          <span className="inline-flex items-center px-1 py-[0.5px] rounded font-medium bg-amber-400/15 text-amber-400">
            RTK
          </span>
          <span className="font-mono truncate">{dispatch.rtkCommand}</span>
        </span>
      )}
      {hasDev && (
        <span className="flex items-center gap-1">
          <span className="inline-flex items-center px-1 py-[0.5px] rounded font-medium bg-blue-400/15 text-blue-400">
            DEV
          </span>
          {dispatch.containerId && (
            <span className="font-mono">{dispatch.containerId}</span>
          )}
        </span>
      )}
    </div>
  );
}

export function EnhancedBashToolRenderer(props: ToolRendererProps) {
  const dispatch = extractDispatchData(props.args);

  // Prefer the original LLM command (pre-cd-injection, pre-RTK) for the header.
  const rawCommand = dispatch?.llmCommand
    ?? (props.args?.command as string)
    ?? "command";

  // Strip leading `cd <path> &&` preamble — show the bare command in the header
  // and surface the path as a CWD chip instead.
  const { display: displayCommand, cwd: parsedCwd } = parseDisplayCommand(rawCommand);

  // Merge: dispatch.cwd (injected by pi-dev-worktrees) takes precedence over
  // a cwd parsed from the LLM's own command string.
  const effectiveCwd = dispatch?.cwd ?? parsedCwd ?? undefined;

  // Build an augmented dispatch view that includes the effective cwd.
  const augmentedDispatch = dispatch
    ? { ...dispatch, cwd: effectiveCwd }
    : parsedCwd
    ? { cwd: effectiveCwd } as BashDispatchData
    : null;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--accent-green)] font-mono">$</span>
        <span className="text-xs text-[var(--text-secondary)] font-mono truncate flex-1">
          {displayCommand}
        </span>
        {augmentedDispatch && <DispatchChips dispatch={augmentedDispatch} />}
      </div>

      {augmentedDispatch && <DispatchDetail dispatch={augmentedDispatch} />}

      {props.status === "running" && !props.result && (
        <div className="text-xs text-[var(--text-muted)] italic">Running…</div>
      )}

      {props.result && (
        <div className="max-h-80 overflow-auto rounded bg-[var(--bg-code)] p-2">
          <pre className="whitespace-pre-wrap text-xs font-mono text-[var(--text-secondary)]">
            {props.result}
          </pre>
        </div>
      )}
    </div>
  );
}
