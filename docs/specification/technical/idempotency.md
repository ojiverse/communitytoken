# Idempotency

Idempotency protects application mutation requests from duplicate delivery.

It is a transport and application consistency guarantee, not a primitive monetary rule or feature
uniqueness rule.

## Scope

An idempotency key is interpreted within the authenticated technical-caller namespace.

Caller namespace and key identify one logical mutation request.

The current Phase 2 product protects registration-intent creation, user TRANSFER, and administrative
ISSUE.

## Request equivalence

Each idempotency scheme version defines a deterministic fingerprint of the logical request.

Equivalent protected content produces the same fingerprint for one version. Materially different
content produces a different fingerprint.

Credentials and the idempotency key itself are not part of request meaning.

## Replay

A completed key with matching version and fingerprint returns the stored result without re-executing
the mutation.

Key reuse with different protected content is rejected.

A successful monetary result includes the committed Transaction identifier in the replayable result.

An expected non-mutating failure does not become a successful replay record merely because a key was
presented.

## Atomicity

A protected successful mutation and its replay record commit atomically.

There must be no committed monetary Transaction without the corresponding successful replay result
when the application operation is idempotency-protected.

ISSUE provenance does not depend on the idempotency record: the issuer Principal is stored on the
Transaction itself.

## Retention

The current model defines no idempotency-record expiry transition.

Adding expiry or deletion changes replay guarantees and requires an explicit specification decision.
