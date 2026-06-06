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
- `monitor-upstream.mjs` is a non-harness maintenance script that reads upstream
  `earendil-works/pi` changes (network required) and writes a summary to stdout / workflow
  step summary.
- The script emits GitHub Actions outputs (`has_important_changes`, `commit_count`,
  `important_count`, `report_path`) when `GITHUB_OUTPUT` is available, so the
  workflow can create an issue only when priority paths changed.

## Verification

- Run the script directly after changing it.
- Run `UPSTREAM_REPO_URL=file:///Users/qiaochao/pi-mono UPSTREAM_BRANCH=main node scripts/monitor-upstream.mjs` as a dry run.
- Run `npm run check` before handoff.
