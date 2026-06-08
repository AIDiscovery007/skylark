# ADR 0003: Keep MessageList Models Separate

## Status

Accepted.

## Context

Chat and review/subagent views both render message-like timelines, but they use
different content models: agent messages and desktop thread messages.

## Decision

Share scaffolding such as size estimation, pinned scrolling, virtualization,
and jump controls. Keep the two content renderers and message models separate.

## Consequences

Shared UI mechanics reduce duplication while avoiding a broad model-convergence
rewrite. Content-specific rendering remains explicit.
