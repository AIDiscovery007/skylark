# ADR 0004: Keep Vendored Kits Whole

## Status

Accepted.

## Context

Some renderer component families are vendored or kit-like. Member-level pruning
inside these families creates maintenance churn and makes future upstream
refreshes harder.

## Decision

Delete orphan whole files and genuinely dead non-vendored exports. Do not prune
individual members out of vendored shadcn/ui or ai-elements families.

## Consequences

Dead local code still gets removed, but vendored kits remain easier to compare
and refresh. Some unused vendored members may remain by design.
