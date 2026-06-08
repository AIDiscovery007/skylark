# ADR 0001: Build Preload Bridge Objects Without Proxy

## Status

Accepted.

## Context

The IPC descriptor collapse will generate or assemble many bridge methods from
metadata. A JavaScript `Proxy` would reduce boilerplate, but Electron
`contextBridge` exposes plain API objects more predictably than dynamic proxy
traps.

## Decision

Build the preload bridge as a loop-built plain object. Stream helpers may be
shared, but the exposed bridge surface remains ordinary methods on an object.

## Consequences

The bridge remains compatible with `contextBridge` and tests can enumerate the
method surface. Descriptor code may be a little more explicit than a proxy-based
approach.
