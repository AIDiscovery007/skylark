# Shared Contract Guide

This subtree owns cross-process contracts used by main, preload, and renderer.

## Rules

- Keep shared files implementation-free: no Electron, DOM, filesystem, shell, or
  renderer component imports.
- Treat `ipc-contract.ts` and shared types as the source of truth for bridge
  shape. Update main handlers, preload bridge, renderer callers, and tests
  together when a contract changes.
- Keep serialized event and request/response types JSON-safe unless a caller is
  explicitly documented to handle richer values.
- Prefer clear discriminated unions and named request types over ad hoc object
  shapes in callers.
- When adding or materially changing a shared contract family, serialized event
  model, provider/settings type, or boundary ownership rule, update this file
  with the local guidance future agents need.

## Verification

- Run affected `test/shared`, `test/preload`, `test/main`, and `test/renderer`
  files when changing IPC or serialized event contracts.
- Run `npm run check` and `npm run test:unit` before handoff.
