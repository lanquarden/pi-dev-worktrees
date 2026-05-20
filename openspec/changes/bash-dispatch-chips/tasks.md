## 1. Capture original LLM command

Spec: `specs/01-capture-and-emit.md`

- [x] 1.1 Add `const pendingLlmCommands = new Map<string, string>()` module-level
- [x] 1.2 Add `tool_execution_start` handler: store `event.args?.command` keyed by `event.toolCallId`

## 2. Emit bash-dispatch event from tool_call

Spec: `specs/01-capture-and-emit.md`

- [x] 2.1 Capture `rtkCommand = event.input.command` at handler entry (post-RTK)
- [x] 2.2 Retrieve and delete `pendingLlmCommands.get(event.toolCallId)` → `llmCommand`
- [x] 2.3 Compute `rtkRewritten = rtkCommand !== llmCommand`
- [x] 2.4 After `applyBashIntercept`, emit:
  ```ts
  pi.events.emit("pi-dev-worktrees:bash-dispatch", {
    toolCallId: event.toolCallId,
    llmCommand,
    rtkRewritten,
    rtkCommand: rtkRewritten ? rtkCommand : undefined,
    routing: result.routing,
    hasDevcontainer: state.devcontainer !== undefined,
  });
  ```

## 3. Tests

Spec: `specs/01-capture-and-emit.md`

- [x] 3.1 Add `tests/bash-dispatch-emit.test.ts`
  - Mock `pi.events.emit`; assert called with correct eventType and payload for:
    - RTK rewrite + container routing
    - RTK rewrite + host routing
    - No RTK + container routing
    - No RTK + host routing
    - HOST: prefix escape hatch
    - Error routing
  - Assert `pendingLlmCommands` cleared after handler
  - Assert emit not called for non-bash tools
