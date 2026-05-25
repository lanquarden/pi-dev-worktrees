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

/** Header chips function for registerToolRenderer opts */
export function renderBashDispatchChips(args?: Record<string, unknown>): React.ReactNode {
  const dispatch = extractDispatchData(args);
  if (!dispatch) return null;
  return <DispatchChips dispatch={dispatch} />;
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
  // This avoids showing the full `cd /long/path && actual-command` boilerplate.
  const displayCommand = dispatch?.llmCommand
    ?? (props.args?.command as string)
    ?? "command";

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--accent-green)] font-mono">$</span>
        <span className="text-xs text-[var(--text-secondary)] font-mono truncate flex-1">
          {displayCommand}
        </span>
        {dispatch && <DispatchChips dispatch={dispatch} />}
      </div>

      {dispatch && <DispatchDetail dispatch={dispatch} />}

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
