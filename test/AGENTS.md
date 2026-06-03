# Test Guide

This subtree owns Vitest coverage for Skylark.

## Rules

- Match tests to the behavior owner: `test/main`, `test/renderer`,
  `test/shared`, `test/preload`, or `test/e2e`.
- Main and preload tests run in node. Renderer tests run in jsdom through
  `vitest.config.ts` environment matching.
- E2E tests must use faux providers and temporary directories. Do not use real
  provider APIs, real API keys, paid tokens, or user data directories.
- Test observable behavior through public APIs, rendered UI, stores, or bridge
  contracts. Avoid tests that only lock down private implementation details.
- If you modify a test file, run that exact file and fix failures before broader
  suites.
- When adding or materially changing a test layer, fixture strategy,
  faux-provider behavior, environment mapping, or required test command, update
  this file so future agents keep the same testing model.

## Commands

- Unit suites: `npm run test:unit`
- Faux-provider e2e suites: `npm run test:e2e`
- Single file:
  `npx tsx node_modules/vitest/dist/cli.js --run test/path/to/file.test.ts`
