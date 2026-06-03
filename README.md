# Skylark

Skylark is a macOS desktop AI agent built with Electron. It is based on the
open-source `badlogic/pi-mono` project and uses the published `@earendil-works/pi-*`
npm packages as third-party dependencies.

## Download

The current public test release is Skylark `0.2.0` for macOS Apple Silicon.
Download the DMG from the GitHub release assets:

- `Skylark-0.2.0-mac-arm64.dmg`
- `Skylark-0.2.0-mac-arm64.zip`
- `Skylark-0.2.0-mac-arm64.sha256.txt`

This build is ad-hoc signed for Apple Silicon startup, but it is not Developer ID
signed or notarized. macOS Gatekeeper warnings are expected. For local testing,
open the app with right-click > Open, or remove quarantine:

```bash
xattr -dr com.apple.quarantine /Applications/Skylark.app
```

Do not use GitHub's automatically generated source zip or tarball as the app
installer. Use the DMG or ZIP assets listed above.

## Development

```bash
npm install --ignore-scripts
npm run check
```

Build an ad-hoc signed, non-notarized macOS Apple Silicon package:

```bash
npm run dist:mac:unsigned
```

The script writes release artifacts to `dist/`.

## Skylark Versioning

Skylark release metadata lives in `Skylark-release.json`:

- `productName`
- `appId`
- `version`
- `buildVersion`

While Skylark is in the 0.x line:

- Debug fixes and small packaging repairs use patch versions, for example `0.2.1`.
- Feature batches use minor versions, for example `0.3.0`.
- Do not use `1.0.0` until the app is intentionally treated as stable.

Use annotated tags named `skylark-v<version>`, for example `skylark-v0.2.0`.

## Security Posture

The Electron renderer runs with:

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- `webSecurity: true`

Privileged access goes through the preload bridge and typed IPC contracts.

## Attribution

Skylark is based on `badlogic/pi-mono`, which is licensed under the MIT License.
See `NOTICE` for attribution details.
