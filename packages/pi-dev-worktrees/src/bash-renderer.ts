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

type RenderTheme = ExtensionContext["ui"]["theme"];
type ToolRowBackground = "toolPendingBg" | "toolSuccessBg" | "toolErrorBg";

interface DispatchCallComponent {
  readonly kind: "pi-dev-worktrees-dispatch-call";
  update(command: string, theme: RenderTheme, context: ToolRenderContext): void;
  render(width: number): string[];
  invalidate(): void;
}

function isDispatchCallComponent(component: unknown): component is DispatchCallComponent {
  return Boolean(component && (component as Partial<DispatchCallComponent>).kind === "pi-dev-worktrees-dispatch-call");
}

function toolRowBackground(context: ToolRenderContext): ToolRowBackground {
  return context.isPartial ? "toolPendingBg" : context.isError ? "toolErrorBg" : "toolSuccessBg";
}

function backgroundStart(theme: RenderTheme, background: ToolRowBackground): string {
  const reset = "\u001b[49m";
  const styled = theme.bg(background, "");
  return styled.endsWith(reset) ? styled.slice(0, -reset.length) : "";
}

export function createDispatchCallComponent(
  initialCommand: string,
  initialTheme: RenderTheme,
  context: ToolRenderContext,
): DispatchCallComponent {
  const toolCallId = context.toolCallId;
  let command = initialCommand;
  let theme = initialTheme;
  let parentBackground = toolRowBackground(context);
  let lastMetadata: BashDispatchMetadata | undefined;
  return {
    kind: "pi-dev-worktrees-dispatch-call",
    update(nextCommand: string, nextTheme: RenderTheme, nextContext: ToolRenderContext) {
      command = nextCommand;
      theme = nextTheme;
      parentBackground = toolRowBackground(nextContext);
    },
    render(width: number): string[] {
      lastMetadata = bashDispatchByToolCall.get(toolCallId) ?? lastMetadata;
      if (!lastMetadata || !hasChips(lastMetadata)) {
        return [truncateToWidth(theme.fg("toolTitle", theme.bold(`$ ${command}`)), width, "...")];
      }
      const renderedCommand = theme.fg("toolTitle", theme.bold(`$ ${lastMetadata.llmCommand}`));
      const chips = chipText(lastMetadata, theme).join(" ");
      const restoreParentBackground = backgroundStart(theme, parentBackground);
      const commandWidth = visibleWidth(renderedCommand);
      const chipsWidth = visibleWidth(chips);
      if (commandWidth + 1 + chipsWidth <= width) {
        return [renderedCommand + " ".repeat(width - commandWidth - chipsWidth) + chips + restoreParentBackground];
      }
      const first = truncateToWidth(renderedCommand, width, "...");
      const secondChips = truncateToWidth(chips, width, "...");
      return [first, " ".repeat(Math.max(0, width - visibleWidth(secondChips))) + secondChips + restoreParentBackground];
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
      if (isDispatchCallComponent(context.lastComponent)) {
        context.lastComponent.update(metadata?.llmCommand || args.command, theme, context);
        return context.lastComponent;
      }
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
