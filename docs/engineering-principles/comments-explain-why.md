# Comments Explain Why

Comments are one of the hardest forms of repository data to maintain. They are unstructured natural
language: the compiler cannot verify them, refactoring tools cannot reliably update them, and their
meaning can become ambiguous as the implementation changes.

Every comment therefore introduces a maintenance obligation. Comments should be rare and reserved
for important design or implementation knowledge that cannot be expressed clearly through types,
names, structure, executable behavior, or a formal configuration.

## Division of responsibility

| Artifact | Responsibility | Question answered |
| --- | --- | --- |
| Docstring | The contract visible to a caller | What does this abstraction provide? |
| Implementation | The mechanics expressed by the code | How does it provide it? |
| Comment | The rationale that is not recoverable from the code | Why was this choice necessary? |

A docstring should describe the relevant contract, not narrate the function body. The implementation
should make its operation understandable through explicit types, names, boundaries, and control
flow. A comment should preserve the reason behind a choice among plausible alternatives.

## What comments should preserve

A valuable comment records context such as:

- an external constraint that forced a non-obvious choice;
- why an apparently simpler or more conventional alternative is invalid;
- a tradeoff whose consequences are not visible in the implementation;
- the reason changing or removing the code would violate an invariant.

The comment should contain enough reasoning for a future maintainer to evaluate whether the
constraint still applies. It should not merely label the chosen technique.

## What comments should not repair

Do not use comments to paraphrase statements, restate types, describe control flow, or compensate
for unclear implementation. If the code does not communicate what it does, improve the model,
names, decomposition, or implementation first.

Before adding a comment, ask:

- Can this knowledge be encoded in the type system or program structure?
- Can clearer code make the explanation unnecessary?
- Does the comment explain why one valid-looking option had to be chosen over another?
- Would removing this rationale make a future incorrect change materially more likely?
- Is the rationale important and stable enough to maintain with the code?

Comments are the last representation to choose, but the most important irreducible rationale is
exactly what they should preserve.
