# Skylark Agent Instructions

This repository is the standalone public Skylark desktop app. Do not reintroduce
the `pi-mono` monorepo layout or source-tree dependencies.

## Environment Model

Treat Skylark as having two practical environments:

- Local development environment: normal repository development from source.
- Packaged release environment: downloadable Skylark desktop artifacts built by Electron Builder.

## Dependency Boundaries

- `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`,
  `@earendil-works/pi-coding-agent`, and `@earendil-works/pi-tui` are third-party
  npm dependencies.
- Do not import from local `pi-mono` source-tree package paths.
- Keep `NOTICE` attribution for `badlogic/pi-mono`.

## Packaged Release Environment

- Skylark desktop release metadata lives in `Skylark-release.json`.
- Treat `Skylark-release.json` as the source of truth for packaged app metadata:
  - `productName`
  - `appId`
  - `version`
  - `buildVersion`
- Electron Builder must read this file and inject the packaged app version through
  `extraMetadata.version` and `buildVersion`.
- Runtime About panel version should come from Electron's active app version.
- Keep packaged user data separate from local development user data.

## Versioning Rules

- Skylark uses SemVer 0.x release versions.
- Current public macOS Apple Silicon test release: `0.2.0`.
- Debug fixes and packaging repairs bump patch versions, for example `0.2.1`.
- Feature batches bump minor versions, for example `0.3.0`.
- Do not use `1.0.0` until the packaged app is intentionally treated as stable.
- Use annotated Skylark tags named `skylark-v<version>`.

## macOS Packaging

- Current supported download target is ad-hoc signed, non-notarized macOS Apple
  Silicon only.
- Build with `npm run dist:mac:unsigned`.
- Expected artifacts use the Skylark release version:
  - `dist/Skylark-<version>-mac-arm64.dmg`
  - `dist/Skylark-<version>-mac-arm64.zip`
- Ad-hoc signed and non-notarized artifacts are expected to trigger Gatekeeper
  warnings.
- Developer ID signing, notarization, and App Store distribution are out of scope until explicitly requested.

## Required Verification

When changing release metadata, Electron Builder config, app identity, About panel
behavior, or packaging:

```bash
npm run check
npx tsx node_modules/vitest/dist/cli.js --run test/main/app-identity.test.ts test/main/electron-builder-config.test.ts test/main/desktop-window-manager.test.ts
npm run dist:mac:unsigned
```

Then verify:

- `dist/Skylark-<version>-mac-arm64.dmg` exists.
- `dist/Skylark-<version>-mac-arm64.zip` exists.
- `dist/mac-arm64/Skylark.app/Contents/Info.plist` has `CFBundleShortVersionString`
  and `CFBundleVersion` matching `Skylark-release.json`.
- `file dist/mac-arm64/Skylark.app/Contents/MacOS/Skylark` reports `arm64`.
- The app launches and loads without a black screen.

## Release Commit Checklist

- Confirm generated release artifacts are not staged.
- Stage only files changed for the release task.
- Create the annotated `skylark-v<version>` tag only after the release commit succeeds.
