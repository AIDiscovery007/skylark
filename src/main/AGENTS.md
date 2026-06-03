# Main Process Guide

This subtree owns Electron main-process behavior: app identity, windows, runtime
hosting, IPC handlers, persistent storage, approvals, terminal/PTY, workspace
runtimes, events, MCP, previews, and environment resources.

## Rules

- Validate renderer input at the IPC boundary before calling services.
- Keep persistent paths explicit and covered by tests; packaged app state must
  stay isolated from local development state.
- Keep Electron, filesystem, shell, and credential access in main-process
  services. Do not leak Electron primitives into renderer-facing contracts.
- Prefer small service interfaces that can be tested with temporary directories,
  fake stores, faux providers, and injected shell/window functions.
- When adding or materially changing a main-process service, IPC handler,
  runtime host behavior, storage path, permission flow, terminal capability, or
  event pipeline, update this file with the local rule or verification change
  future agents need.
- For runtime, terminal, approval, storage, or event changes, add regression
  tests under `test/main` or extend the existing focused test in that area.

## Verification

- Run the specific `test/main/*.test.ts` file you changed or covered.
- Run `npm run check` and `npm run test:unit` before handoff.
- For packaging, identity, storage-path, or window-manager changes, run the
  release verification listed in the root `AGENTS.md`.
