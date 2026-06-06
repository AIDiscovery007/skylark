# Renderer Guide

This subtree owns the React desktop workbench: chat, settings, capabilities,
events, review workspace, terminal UI, stores, hooks, and renderer-only
presentation logic.

## Rules

- Keep user-visible workflows stable: avoid layout shift, opacity flash, text or
  icon jitter, and state flicker in pending/selected controls.
- Put cross-process data shapes in `src/shared`; renderer code should consume
  the preload bridge rather than importing main-process services.
- Keep stores and hooks deterministic. Prefer explicit loading/error states and
  tests that assert visible behavior through rendered UI or store APIs.
- Use existing UI primitives and lucide icons when a suitable primitive exists.
- Composer input surfaces should use the shared AI Elements Prompt Input shell
  in `components/chat/SkylarkPromptInputComposer.tsx`; keep slash/@ suggestion
  data flow and runtime submission behavior in the caller.
- High-volume renderer lists and flattened trees should prefer the shared
  `components/ui/virtual-stack.tsx` primitive before adding feature-local
  virtualization code. Keep feature-specific row rendering, filtering,
  selection, and tree flattening in the owning component.
- Chat history state may be windowed. Preserve `messageWindow` when refreshing
  snapshots, and load older messages through the preload bridge rather than
  assuming `DesktopAgentSnapshot.messages` is the full transcript.
- Do not add visible instructional text about implementation details, shortcuts,
  or styling unless the product workflow requires it.
- When adding or materially changing a major workbench area, store contract,
  interaction pattern, layout system, or renderer-only workflow, update this
  file with the local rule or verification change future agents need.

## Verification

- Run the specific `test/renderer/*.test.ts(x)` file for changed UI, store, or
  hook behavior.
- Run `npm run check` and `npm run test:unit` before handoff.
- After significant interactive UI changes, manually verify hover, click,
  pending, selected, resize, and empty/loading states in the app.
