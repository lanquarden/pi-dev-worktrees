import React from "react";
import type { ToolRendererProps } from "@blackbelt-technology/dashboard-plugin-runtime";

interface BashDispatchData {
  llmCommand?: string;
  rtkRewritten?: boolean;
  rtkCommand?: string;
  routing?: "host" | "container" | "error";
  containerId?: string;
  hasDevcontainer?: boolean;
}

function extractDispatchData(args?: Record<string, unknown>): BashDispatchData | undefined {
  return (args as any)?._pluginData?.["pi-dev-worktrees:bash-dispatch"] as BashDispatchData | undefined;
}

function DispatchChips({ dispatch }: { dispatch: BashDispatchData }) {
  return (
    <span className="flex items-center gap-1.5 shrink-0">
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
        <span className="inline-flex items-center px-1.5 py-[1px] rounded text-[10px] font-sans bg-[var(--bg-quaternary)] text-[var(--text-secondary)]">
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

/** Detail line showing RTK rewrite or container exec target */
function DispatchDetail({ dispatch }: { dispatch: BashDispatchData }) {
  if (!dispatch.rtkRewritten && dispatch.routing !== "container") return null;
  return (
    <div className="flex items-center gap-1.5 mt-1 text-[10px] text-[var(--text-muted)]">
      {dispatch.rtkRewritten && dispatch.rtkCommand && (
        <span className="flex items-center gap-1">
          <span className="inline-flex items-center px-1 py-[0.5px] rounded font-medium bg-amber-400/15 text-amber-400">
            RTK
          </span>
          <span className="font-mono truncate">{dispatch.rtkCommand}</span>
        </span>
      )}
      {dispatch.routing === "container" && (
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

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--accent-green)] font-mono">$</span>
        <span className="text-xs text-[var(--text-secondary)] font-mono truncate flex-1">
          {(props.args?.command as string) ?? "command"}
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
