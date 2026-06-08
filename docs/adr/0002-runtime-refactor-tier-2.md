# ADR 0002: Keep Runtime Refactor To Tier 2

## Status

Accepted.

## Context

The runtime files mix policy, tool assembly, host persistence, and subagent
orchestration. A deeper mode de-smear across files is possible, but it is higher
risk than the current refactor program needs.

## Decision

First extract Tier 2 boundaries: `subagent-engine`, `runtime-mode-policy`,
`builtin-tools`, and `runtime-contract`. Defer cross-file mode de-smearing until
the smaller boundaries are landed and verified.

## Consequences

The runtime gets clearer seams without rewriting mode behavior in the same
slice. Some mode-related duplication may remain temporarily.
