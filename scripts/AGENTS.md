# Harness Script Guide

This subtree owns repository harness and maintenance scripts.

## Rules

- Harness scripts must be deterministic, local, and network-free unless their
  name and documentation explicitly say otherwise.
- Checks should read repository state and fail with actionable output. Do not
  silently rewrite tracked files from a `check:*` script.
- Keep scripts standalone Node ESM where practical and avoid adding production
  dependencies for repository-only checks.
- When adapting a `pi-mono` quality rule, preserve the intent but target
  Skylark's single-package Electron repository.
- When adding or materially changing a harness script, pre-commit rule,
  release/package check, or maintenance command, update this file with the local
  behavior and verification expectation future agents need.

## Verification

- Run the script directly after changing it.
- Run `npm run check` before handoff.
