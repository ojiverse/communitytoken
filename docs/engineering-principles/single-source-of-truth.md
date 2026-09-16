# Single Source of Truth

Every declarative fact should have one authoritative owner. Examples include schemas, dependency
versions, infrastructure definitions, and deployment configuration.

Copying those facts into a test or helper creates a second authority. The copy can drift, and every
change then requires synchronized edits. A check intended to prevent mistakes becomes another
place where mistakes can occur.

## Design rule

Choose the source of truth before choosing its validation. Other components should consume that
source or observe its effects. They should not restate it as a parallel list of expected values.

A derived artifact is safe when it is generated mechanically and can be discarded and recreated.
A hand-maintained copy is not derived; it is a competing authority.

## Ownership includes interpretation

Single ownership applies to semantics as well as stored values. The subsystem that defines a format
usually has the best knowledge of its syntax, meaning, and lifecycle. Its native execution and
validation mechanisms should interpret the authoritative source.

Reimplementing those rules in a repository script creates a second semantic authority even when it
reads the original source. The custom interpreter must track specification changes, edge cases, and
environment differences, and it may diverge while continuing to appear authoritative.

Native mechanisms therefore follow directly from the Single Source of Truth principle. When
validating a concern, prefer:

1. The owning subsystem's normal execution path.
2. Its native validation or planning command.
3. A behavior test at the boundary consumed by the application.
4. A custom checker only when it adds project-specific knowledge the earlier layers cannot express.

This order keeps both the facts and their interpretation with the subsystem that owns them.

## Questions to ask

- Which file or subsystem owns this fact?
- Would a future change require editing the same fact in two places?
- Can the consumer read or apply the authoritative definition directly?
- Is the owning subsystem interpreting and enforcing its own definition?
- Is a generated artifact being mistaken for repository source?

Clear ownership reduces both drift and debate. When something is wrong, maintainers know where it
must be corrected.
