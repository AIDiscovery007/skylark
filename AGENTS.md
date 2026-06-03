# Skylark Repository Guide

This is the current guide for the standalone public Skylark desktop app. It
combines the repository handoff notes and the agent development instructions.

Do not reintroduce the `pi-mono` monorepo layout or source-tree dependencies.
Future Skylark app work should happen in this repository.

## Codex Instruction Layering

Codex loads `AGENTS.md` files from the repository root down to the current
working directory. Keep this root file as the shared source of truth for
repository-wide rules. Nested `AGENTS.md` files should only add local module
constraints and must not repeat or weaken this file.

When adding a nested `AGENTS.md`, keep it short, practical, and scoped to the
subtree it lives in. If a rule applies everywhere, put it here instead.

## Instruction Maintenance

Keep these instruction files current as the codebase evolves. When a change
adds, removes, or materially changes a key module, architecture boundary,
cross-process contract, storage policy, release flow, harness command, or
critical developer workflow, update the relevant `AGENTS.md` file in the same
change.

- Update this root file for repository-wide rules, module map changes,
  dependency boundaries, release policy, storage policy, or required
  verification changes.
- Update the nearest nested `AGENTS.md` when the change affects only that
  subtree's ownership, local rules, or verification commands.
- Do not duplicate root rules in nested files. Add only the local delta needed
  by future agents working in that subtree.
- If no instruction update is needed for a substantial architecture or module
  change, state why the existing guidance already covers it in the handoff or
  final response.

## Repository Purpose

- Primary local repo: `/Users/qiaochao/skylark`
- Public GitHub repo: <https://github.com/AIDiscovery007/skylark>
- Current public release tag: `skylark-v0.2.0`
- Current release page:
  <https://github.com/AIDiscovery007/skylark/releases/tag/skylark-v0.2.0>
- Release metadata source: `Skylark-release.json`

Use this repository for:

- Skylark desktop UI and runtime changes.
- macOS app packaging and release work.
- Skylark app versioning.
- GitHub Releases and downloadable DMG/ZIP assets.

## Module Map

- `src/main`: Electron main process, app identity, window creation, runtime
  host, IPC handlers, storage, approvals, terminal/PTY, workspace runtimes,
  events, MCP, preview, and environment resources.
- `src/renderer`: React desktop workbench, chat, settings, capabilities, events,
  review workspace, terminal UI, stores, hooks, and renderer-only presentation
  logic.
- `src/shared`: Cross-process IPC contracts, serialized event shapes, provider
  IDs, settings types, and other data that must be safe for main, preload, and
  renderer.
- `src/preload`: Secure bridge between Electron IPC and the renderer. This is
  the only place that should expose desktop bridge methods to `window`.
- `test`: Vitest coverage split by `main`, `renderer`, `shared`, `preload`, and
  faux-provider `e2e` flows.
- `scripts`: Repository harness scripts for dependency policy, standalone
  boundary checks, import checks, lockfile commit review, and maintenance tasks.

## Repository Boundaries

`/Users/qiaochao/pi-mono/packages/desktop-ai-agent` was the source/reference
implementation used to bootstrap Skylark.

Do not use it as the Skylark release repository. Do not publish Skylark DMG/ZIP
assets from the `pi-mono` repository unless the user explicitly asks to change
the product strategy.

It can still be useful as historical context or for comparing upstream desktop
app behavior, but normal product iteration should stay in `/Users/qiaochao/skylark`.

## Environment Model

Treat Skylark as having two practical environments:

- Local development environment: normal repository development from source.
- Packaged release environment: downloadable Skylark desktop artifacts built by
  Electron Builder.

Downloaded Skylark builds should use the same visible Skylark agent home as
local development. This is intentional so users can find and inspect their
agent instructions, sessions, skills, prompts, auth metadata, and event data
without digging through platform-specific application folders.

Agent-facing state belongs under:

```text
~/.skylark
```

Platform-only Electron state, such as window state, may remain under Electron
`userData`, for example `~/Library/Application Support/Skylark/desktop-agent`.
Packaged releases must not read or migrate local source-tree data from
`/Users/qiaochao/pi-mono`.

## Dependency Boundaries

Treat `pi-mono` as an upstream third-party open-source dependency source.

Skylark should depend on published npm packages such as:

- `@earendil-works/pi-ai`
- `@earendil-works/pi-agent-core`
- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-tui`

Do not copy the full `pi-mono` source tree or monorepo history into Skylark. Do
not import from local `pi-mono` source-tree package paths such as `../ai/src`,
`../agent/src`, `../coding-agent/src`, or `../tui/src`.

Keep MIT attribution in `NOTICE` when reusing upstream source, including the
existing attribution for `badlogic/pi-mono`.

Direct external dependencies in `package.json` must stay pinned to exact
registry versions. The `@earendil-works/pi-*` packages are third-party npm
dependencies in this repository, not workspace packages. Do not use `workspace:`,
`file:`, `link:`, git, HTTP, or local source-tree dependency specifiers.

## Packaged Release Metadata

Skylark desktop release metadata lives in `Skylark-release.json`. Treat this
file as the source of truth for packaged app metadata:

- `productName`
- `appId`
- `version`
- `buildVersion`

Electron Builder must read this file and inject the packaged app version through
`extraMetadata.version` and `buildVersion`.

Runtime About panel version should come from Electron's active app version.
Packaged user data must stay separate from local development user data.

## Versioning Rules

Skylark versions are independent from upstream package versions. Bump
`Skylark-release.json` for product releases, using SemVer 0.x while the app is
still a beta/test distribution.

- Current public macOS Apple Silicon test release: `0.2.0`.
- Debug fixes and packaging repairs bump patch versions, for example `0.2.1`.
- Feature batches bump minor versions, for example `0.3.0`.
- Do not use `1.0.0` until the packaged app is intentionally treated as stable.
- Use annotated Skylark tags named `skylark-v<version>`.

## macOS Packaging

Current distribution policy:

- macOS Apple Silicon first.
- DMG and ZIP artifacts.
- Ad-hoc signed only.
- No Developer ID signing.
- No notarization.
- Gatekeeper warnings are expected for downloaded artifacts.

Build with:

```bash
npm run dist:mac:unsigned
```

The packaging script must clean old `out/` and `dist/` output before building so
release checks and upload steps cannot accidentally pick up stale artifacts.

Expected artifacts use the Skylark release version:

- `dist/Skylark-<version>-mac-arm64.dmg`
- `dist/Skylark-<version>-mac-arm64.zip`

Developer ID signing, notarization, and App Store distribution are out of scope
until explicitly requested.

Document user-facing install guidance in `README.md` and release notes when
publishing a new version.

## Updating Skylark When `pi-mono` Updates

Recommended flow:

1. Work in `/Users/qiaochao/skylark`.
2. Create a short-lived branch for the update.
3. Check the new upstream npm versions for the `@earendil-works/pi-*` packages.
4. Upgrade the pinned dependency versions together in `package.json`.
5. Refresh `package-lock.json` with `npm install --ignore-scripts`.
6. Fix compile or API incompatibilities inside Skylark adapter code only.
7. Do not reintroduce monorepo aliases or local source-tree imports.
8. Run verification.
9. Install or launch the app from the built artifact and smoke test it.
10. Bump `Skylark-release.json` for the next Skylark product version.
11. Commit, create an annotated tag such as `skylark-v0.2.1`, push, and create
    a GitHub prerelease with DMG/ZIP/SHA256 assets.

## Required Verification

For ordinary code changes, run the smallest relevant test or check that proves
the change. Broaden verification when touching shared behavior, app startup,
packaging, release metadata, storage paths, or dependency versions.

For code changes, run:

```bash
npm run check
npm run test:unit
```

If the change touches end-to-end runtime behavior, agent tool execution,
subagent orchestration, or cross-process conversation flow, also run:

```bash
npm run test:e2e
```

Before committing, run:

```bash
npm run precommit
```

If you create or modify a test file, run that test file directly and iterate
until it passes before running broader suites.

When changing release metadata, Electron Builder config, app identity, About
panel behavior, packaged storage paths, upstream `pi-*` package versions, or
packaging:

```bash
npm run check
npm run test:unit
npm run test:e2e
npx tsx node_modules/vitest/dist/cli.js --run test/main/storage-paths.test.ts test/main/app-identity.test.ts test/main/electron-builder-config.test.ts test/main/desktop-window-manager.test.ts
npm run dist:mac:unsigned
```

Then verify:

- `dist/Skylark-<version>-mac-arm64.dmg` exists.
- `dist/Skylark-<version>-mac-arm64.zip` exists.
- `dist/mac-arm64/Skylark.app/Contents/Info.plist` has
  `CFBundleShortVersionString` and `CFBundleVersion` matching
  `Skylark-release.json`.
- `file dist/mac-arm64/Skylark.app/Contents/MacOS/Skylark` reports `arm64`.
- `codesign --verify --deep --strict --verbose=2 dist/mac-arm64/Skylark.app`
  succeeds for the expected ad-hoc signed build.
- The app launches and loads without a black screen.

Smoke test the packaged app:

- First-run state is empty.
- Settings opens.
- A project can be selected or created.
- Terminal/PTY opens.
- A simple agent session can start.

## Release Commit Checklist

- Confirm generated release artifacts are not staged.
- Stage only files changed for the release task.
- Create the annotated `skylark-v<version>` tag only after the release commit
  succeeds.

## Suggested Agent Skills

Future agents should use:

- `tdd` for behavior changes and regression tests.
- `diagnose` for packaged-app bugs, black screens, runtime crashes, state leaks,
  or environment differences between dev and release.
- `build-macos-apps:packaging-notarization` for DMG/ZIP/app bundle validation,
  signing, Gatekeeper, and notarization-related work.
- `github:github` for GitHub repository and release work.
- `git-commit` when the user explicitly asks to commit changes.

## Guardrails

- Do not publish from `/Users/qiaochao/pi-mono` for Skylark.
- Do not expose the full `pi-mono` monorepo in the Skylark public repository.
- Do not commit `node_modules`, `out`, `dist`, Electron caches, local session
  data, or userData.
- Do not switch back to root `release:*` scripts from `pi-mono` for Skylark app
  versioning.
- Keep `Skylark-release.json` as the product release metadata source.
- Never bypass the pre-commit harness with `git commit --no-verify`.
- When committing lockfile changes intentionally, use
  `SKYLARK_ALLOW_LOCKFILE_CHANGE=1` and include only the reviewed lockfile diff.
