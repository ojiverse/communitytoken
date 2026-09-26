# Idempotency

Idempotency protects application mutation requests from duplicate delivery.

It is a transport and application consistency guarantee, not a primitive monetary rule and not a
feature-domain uniqueness rule.

## Scope

An idempotency key is interpreted within the authenticated technical-caller namespace.

The caller namespace and idempotency key together identify one logical mutation request.

## Request equivalence

Each idempotency scheme version defines a deterministic fingerprint of the logical request.

For one version, semantically identical protected request content must produce the same fingerprint,
while materially different protected content must produce a different fingerprint.

Credentials and the idempotency key itself are not part of request meaning.

Concrete canonicalization and digest representation belong to the interface implementation contract.

## Replay

When a completed key is seen again with the same version and fingerprint, the stored result is
returned without re-executing the mutation.

Reusing the same key with different protected content is rejected.

The stored result is authoritative for a successful replay.

An expected non-mutating failure does not become a successful replay record merely because a key was
presented.

## Atomicity

A protected successful mutation and the replay record describing that committed result are one
atomic application transaction.

There must be no committed state in which the protected monetary Transaction succeeded while the
successful replay result was not recorded.

A failed primitive or application operation must not consume independent feature eligibility or
become a successful mutation record merely because an idempotency key was supplied.

## Retention

The current model defines no idempotency-record expiry transition.

Adding expiry or deletion changes replay guarantees and therefore requires an explicit specification
decision.
