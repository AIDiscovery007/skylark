# Preload Bridge Guide

This subtree owns the safe bridge between Electron IPC and renderer code.

## Rules

- Expose the minimum renderer API needed by `DesktopAgentBridge`.
- Do not expose `ipcRenderer`, Electron event objects, filesystem access, shell
  access, or other Electron primitives to the renderer.
- Keep bridge methods aligned with `src/shared/ipc-contract.ts` and registered
  main IPC handlers.
- MessagePort streams should be opened once per stream type and tested for
  event forwarding and unsubscribe behavior.
- When adding or materially changing bridge surface area, stream behavior,
  exposure rules, or contract synchronization requirements, update this file
  with the local guidance future agents need.

## Verification

- Run `npx tsx node_modules/vitest/dist/cli.js --run test/preload/create-bridge.test.ts`
  after preload bridge changes.
- Run `npm run check` and `npm run test:unit` before handoff.
