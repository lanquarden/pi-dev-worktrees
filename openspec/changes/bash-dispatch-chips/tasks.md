## 1. Capture original LLM command

Spec: `specs/01-capture-and-emit.md`

- [x] 1.1 Add `const pendingLlmCommands = new Map<string, string>()` module-level in `packages/pi-dev-worktrees/src/index.ts`
- [x] 1.2 Add `tool_execution_start` handler: if `event.toolName === "bash"`, store `event.args?.command ?? ""` in `pendingLlmCommands` keyed by `event.toolCallId`

## 2. Emit bash-dispatch from tool_call

Spec: `specs/01-capture-and-emit.md`

- [x] 2.1 In the `tool_call` handler, capture `rtkCommand = (event.input as { command: string }).command` at handler entry (post-RTK, pre-routing)
- [x] 2.2 After `applyBashIntercept`, read and delete `pendingLlmCommands.get(event.toolCallId)` → `llmCommand` (fallback to `rtkCommand` if missing)
- [x] 2.3 Compute `rtkRewritten = rtkCommand !== llmCommand`
- [x] 2.4 Emit via `ctx.ui.notify`:
  ```ts
  ctx.ui.notify(llmCommand, {
    toolCallId: event.toolCallId,
    method: "bash-dispatch",
    props: {
      llmCommand,
      rtkRewritten,
      rtkCommand: rtkRewritten ? rtkCommand : undefined,
      routing: result.routing,
      errorMessage: result.routing === "error" ? /* extract from result.command */ undefined : undefined,
      hasDevcontainer: state.devcontainer !== undefined,
    },
  });
  ```
- [x] 2.5 No `tool_result` changes — suppression mechanism handles dismiss automatically

## 3. Tests

Spec: `specs/01-capture-and-emit.md`

- [x] 3.1 Add `tests/bash-dispatch-emit.test.ts`
  - Mock `ctx.ui.notify`; assert called with correct `toolCallId`, `method: "bash-dispatch"`, and props for:
    - RTK rewrite + container routing
    - RTK rewrite + host routing
    - No RTK + container routing
    - No RTK + host routing (passthrough)
    - HOST: prefix escape hatch → routing=host, rtkRewritten=false
    - Error routing → routing=error
  - Assert `pendingLlmCommands` is cleared after `tool_call` completes
  - Assert `notify` not called for non-bash tool calls
