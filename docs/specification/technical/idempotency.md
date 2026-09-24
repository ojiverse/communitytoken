# Idempotency

Idempotency protects mutation requests from duplicate delivery.

It is a transport/application consistency guarantee. It does not decide whether two independently
identified commands are equivalent under an external feature's business rules.

## Scope

An idempotency key is interpreted within the authenticated service-principal namespace.

The pair:

(service principal, idempotency key)

identifies one logical mutation request.

## Request equivalence

Each idempotency scheme version defines a deterministic fingerprint of the logical request.

For the same version:

- semantically identical protected request content must produce the same fingerprint;
- a materially different request must produce a different fingerprint.

Credentials and the idempotency key itself are not part of request meaning.

The concrete canonicalization and digest representation are implementation contract details and are
tracked with the interface implementation.

## Replay

For a previously completed key:

- matching version and fingerprint returns the stored result without re-executing the mutation;
- a mismatching fingerprint is rejected as key reuse.

The stored result is the authority for successful replay.

An expected non-mutating failure is not made into a successful replay record merely because an
idempotency key was presented.

## Atomicity

The protected mutation and the replay record describing its committed result are one transaction.

There must be no committed state in which the protected mutation succeeded but its replay result was
not recorded.

A failed domain operation must not consume independent business eligibility or become a successful
mutation record merely because an idempotency key was presented.

## Retention

The current model has no idempotency-record expiry transition.

Adding expiry or deletion requires an explicit specification change because it changes replay
guarantees.
