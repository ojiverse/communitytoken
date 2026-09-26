# Comments Explain Why

Comments are expensive repository state.

The compiler cannot verify them, refactoring tools update them imperfectly, and prose can remain
plausible after the code it described has changed.

Comments should therefore preserve rationale that cannot be expressed clearly through names, types,
structure, tests, specifications, or configuration.

## Division of responsibility

A public contract explains what an abstraction guarantees.

Implementation shows how the guarantee is achieved.

A comment explains why a non-obvious implementation choice is necessary when that reason cannot be
recovered from the surrounding design.

## Good reasons to comment

A comment is useful when it records an external constraint, a rejected but plausible implementation,
a non-obvious tradeoff, or the reason removing a piece of code would violate an invariant.

The comment should contain enough context for a future maintainer to determine whether the reason
still applies.

## What comments should not do

Comments should not paraphrase statements, restate types, narrate control flow, preserve obsolete
architecture, or compensate for unclear names and decomposition.

When code and current specification disagree, adding a comment that explains the old model does not
repair the mismatch.

Improve the model or implementation instead.

## Decision test

Before adding a comment, ask whether the knowledge can be represented structurally, whether clearer
code would make the prose unnecessary, whether the rationale is stable, and whether losing it would
make a future incorrect change materially more likely.

Comments are the last representation to choose, but they are valuable when they preserve essential
reasoning that no stronger mechanism can express.
