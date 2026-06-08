# Skylark Context

This file records repository vocabulary that should stay stable across future
architecture work. Keep it current when module boundaries, cross-process
contracts, or domain terms materially change.

## Domain Nouns

- **Project**: a user-selected local repository or working directory.
- **Workspace**: an app-managed runtime area for a project task, including pane
  definitions, tmux metadata, lifecycle state, and resource policy.
- **Session**: a persisted agent conversation with messages, model settings,
  mode, task progress, and project association.
- **Runtime**: the live agent execution object for a session or workspace.
- **Pane**: a tmux-backed workspace surface such as agent, shell, dev-server,
  test, or logs.
- **Event**: a tracked task or workflow item with status, priority, comments,
  attachments, and optional run state.
- **Capability**: an agent-available tool surface such as skills, prompt
  templates, or MCP tools.
- **Approval**: a user decision gate for privileged local actions.
- **Environment Resource**: a discoverable external or runtime resource, such as
  a tmux session/window, that the UI can list, detach, or inspect.
- **Preview**: a desktop web or file view scoped to authorized local content.

## Theme A Deep Modules

- `src/shared/errors.ts`: pure cross-process error message normalization.
- `src/shared/guards.ts`: pure cross-process type guards.
- `src/main/storage/fs-errors.ts`: Node filesystem error guards.
- `src/main/util/path-scope.ts`: path containment and realpath containment.
- `src/main/util/port-fanout.ts`: generic listener registries and Electron port
  fan-out plumbing.
- `test/support/temp-dir.ts`: shared Vitest temp directory lifecycle helper.

## Planned BCDE Module Names

- **descriptor table**: the future IPC source of truth for channel names,
  request validation, and response types.
- `runtime-contract`: the future runtime interface/persistence boundary that
  breaks host/create-runtime back-edges.
- `subagent-engine`: the future home for subagent orchestration currently inside
  mode-aware runtime policy.
- `runtime-mode-policy`: the future pure-decision module for mode/tool policy.
- `useSubscribedResource`: the future renderer hook for MessagePort-style
  subscriptions.
- `applySessionSnapshot`: the future renderer fan-out helper for applying an
  agent snapshot consistently across stores.

## Architecture Vocabulary

- **Module**: the home for a behavior with a clear import boundary.
- **Interface**: the small surface callers use; keep this stable and tested.
- **Deep module**: a small interface hiding repeated or risky implementation
  detail.
- **Shallow module**: a thin pass-through or one-off wrapper; avoid adding these
  without a concrete reason.
- **Seam**: an intentionally narrow boundary for tests or platform adaptation,
  such as the `PortLike<T>` interface.
- **Leverage**: code that removes repeated behavior from multiple call sites.
- **Locality**: keeping a rule close to the concept it governs so future changes
  have one obvious home.
- **Deletion test**: a grep-backed proof that removed code has no production
  importers and only expected tests need adjustment.
