# Idempotency

Idempotency protects mutation requests from duplicate delivery.

It is a transport/application consistency guarantee, not a replacement for domain uniqueness such as
Daily Reward eligibility.

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

- matching version and fingerprint returns the stored result without re-executing the request;
- a mismatching fingerprint is rejected as key reuse.

The stored result is the authority for replay.

A completed result may be either a successful mutation or a terminal non-mutating outcome when
re-evaluating the same logical request later could give it a different meaning.

A failure explicitly defined as retryable is not a completed result merely because an idempotency key
was presented.

## Atomicity

A protected mutation and the replay record describing its completed result are one transaction.

There must be no committed state in which the protected mutation succeeded but its replay result was
not recorded.

Recording a terminal non-mutating result may consume the idempotency key but must not consume an
independent feature eligibility that the domain says remains available.

A failed domain operation that is defined as retryable must not consume independent feature
eligibility or be frozen as a completed replay result.

## Retention

The current model has no idempotency-record expiry transition.

Adding expiry or deletion requires an explicit specification change because it changes replay
guarantees.
