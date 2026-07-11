import type { ExtensionAPI, ExtensionContext, ToolRenderContext } from "@earendil-works/pi-coding-agent";
import { createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { BashRouting } from "./bash-intercept.js";

export type RtkExecution = "none" | "applied" | "fallback";

export interface BashDispatchMetadata {
  llmCommand: string;
  routing: BashRouting;
  containerId?: string;
  cwd?: string;
  rtk: RtkExecution;
  rtkRewritten: boolean;
  rtkCommand?: string;
  hasDevcontainer: boolean;
  containerTargetingActive?: boolean;
  managedWorktree: boolean;
}

export const bashDispatchByToolCall = new Map<string, BashDispatchMetadata>();
const rendererInvalidators = new Map<string, () => void>();

export function setBashDispatch(toolCallId: string | undefined, metadata: BashDispatchMetadata): void {
  if (!toolCallId) return;
  bashDispatchByToolCall.set(toolCallId, metadata);
  rendererInvalidators.get(toolCallId)?.();
}

export function cleanupBashDispatch(toolCallId: string | undefined): void {
  if (!toolCallId) return;
  bashDispatchByToolCall.delete(toolCallId);
  rendererInvalidators.delete(toolCallId);
}

export function resetBashRendererState(): void {
  bashDispatchByToolCall.clear();
  rendererInvalidators.clear();
}

function hasChips(metadata: BashDispatchMetadata): boolean {
  return metadata.routing !== "host" || metadata.containerTargetingActive || metadata.rtk !== "none" ||
    (metadata.managedWorktree && Boolean(metadata.cwd));
}

function chipText(metadata: BashDispatchMetadata, theme: ExtensionContext["ui"]["theme"]): string[] {
  const chips: string[] = [];
  if (metadata.routing === "container") {
    const id = metadata.containerId ? ` ${metadata.containerId.slice(0, 12)}` : "";
    chips.push(theme.bg("toolPendingBg", theme.fg("accent", ` DEV${id} `)));
  } else if (metadata.routing === "error") {
    chips.push(theme.bg("toolErrorBg", theme.fg("error", " error ")));
  } else if (metadata.containerTargetingActive) {
    chips.push(theme.bg("toolPendingBg", theme.fg("warning", " HOST ")));
  }
  if (metadata.rtk !== "none") {
    chips.push(theme.bg("toolPendingBg", theme.fg("accent", metadata.rtk === "fallback" ? " RTK fallback " : " RTK ")));
  }
  if (metadata.managedWorktree && metadata.cwd) {
    chips.push(theme.bg("toolPendingBg", theme.fg("muted", ` CWD ${metadata.cwd} `)));
  }
  return chips;
}

export function createDispatchCallComponent(
  initialCommand: string,
  theme: ExtensionContext["ui"]["theme"],
  context: ToolRenderContext,
) {
  let lastMetadata: BashDispatchMetadata | undefined;
  return {
    render(width: number): string[] {
      lastMetadata = bashDispatchByToolCall.get(context.toolCallId) ?? lastMetadata;
      if (!lastMetadata || !hasChips(lastMetadata)) {
        return [truncateToWidth(theme.fg("toolTitle", theme.bold(`$ ${initialCommand}`)), width, "...")];
      }
      const command = theme.fg("toolTitle", theme.bold(`$ ${lastMetadata.llmCommand}`));
      const chips = chipText(lastMetadata, theme).join(" ");
      const commandWidth = visibleWidth(command);
      const chipsWidth = visibleWidth(chips);
      if (commandWidth + 1 + chipsWidth <= width) {
        return [command + " ".repeat(width - commandWidth - chipsWidth) + chips];
      }
      const first = truncateToWidth(command, width, "...");
      const secondChips = truncateToWidth(chips, width, "...");
      return [first, " ".repeat(Math.max(0, width - visibleWidth(secondChips))) + secondChips];
    },
    invalidate() {},
  };
}

export function registerNativeBashRenderer(
  pi: ExtensionAPI,
  sessionCwd: string,
  ctx: ExtensionContext,
): boolean {
  if (ctx.mode !== "tui") return false;
  const existing = pi.getAllTools().find((tool) => tool.name === "bash");
  if (existing && existing.sourceInfo.source !== "builtin") {
    ctx.ui.notify(
      `Native pi-dev-worktrees routing chips are unavailable because bash is owned by ${existing.sourceInfo.source}.`,
      "warning",
    );
    return false;
  }

  const stock = createBashToolDefinition(sessionCwd);
  const stockRenderCall = stock.renderCall;
  pi.registerTool({
    ...stock,
    renderCall(args, theme, context) {
      rendererInvalidators.set(context.toolCallId, context.invalidate);
      const metadata = bashDispatchByToolCall.get(context.toolCallId);
      if (!metadata || !hasChips(metadata)) {
        return stockRenderCall
          ? stockRenderCall(args, theme, context)
          : createDispatchCallComponent(args.command, theme, context);
      }
      return createDispatchCallComponent(metadata.llmCommand || args.command, theme, context);
    },
  });
  return true;
}
