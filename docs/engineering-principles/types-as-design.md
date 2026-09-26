# Types as Design

The type system is a design medium.

Types can express domain concepts, valid states, permitted transitions, and boundary contracts before
runtime logic is written.

## Type confirmed distinctions

Principal identifiers, Account identifiers, Transaction identifiers, and ExternalIdentity components
may share a runtime representation while carrying different meaning.

The type system should preserve those distinctions.

Do not create a type hierarchy for an unconfirmed Principal or Account taxonomy.

## Encode primitive alternatives

ISSUE and TRANSFER are real alternatives because they have different monetary effects and required
references.

An ISSUE type requires issuer Principal, destination Account, and amount.

A TRANSFER type requires source Account, destination Account, and amount.

Product labels such as distribution or reward are not primitive alternatives when they do not change
the monetary transition.

## Application designation

Default Account is an application relation with an at-most-one invariant per Principal.

It should not be encoded as an Account subtype.

## External data

Runtime inputs remain untrusted until validated.

After validation, convert them into the strongest internal type that accurately represents the
confirmed contract.

## Relationship to tests

Static types prove only properties represented in the type system.

Tests remain necessary for arithmetic, persistence, runtime integrations, protocol behavior, and
concurrency.

Use tests to complement the type model rather than compensate for distinctions that could have been
made structurally impossible.
