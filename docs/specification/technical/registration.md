# Registration

Registration proves one expected ExternalIdentity and creates or resolves its stable Principal
binding.

It is a one-shot identity-establishment transaction, not a long-lived login session.

## Registration intent

A registration intent fixes one expected ExternalIdentity, one unpredictable correlation state, one
authentication nonce, one proof-key secret, a creation time, an expiry time, and a lifecycle state.

Its lifetime is exactly six hundred seconds.

At most one status-active intent exists for an ExternalIdentity.

Lifecycle status and temporal validity are distinct. An intent may still have active status after its
expiry time, but an expired intent is unusable.

Creating a newer intent for the same ExternalIdentity supersedes any older status-active intent.

## Proof binding

The ExternalIdentity proven by authentication must equal the ExternalIdentity fixed when the intent
was created.

Both issuer and subject must match exactly.

Possession of a forwarded registration URL therefore cannot bind a different authenticated subject.

## Single use

An expired, consumed, or superseded intent cannot complete registration.

A failed or mismatched proof does not consume the intent. The intended subject may retry while the
same intent remains active and unexpired.

Completion rechecks intent validity and exact identity equality inside the same serialized boundary
that creates or resolves the binding.

## First successful result

When the ExternalIdentity is not already bound, successful registration atomically creates one
Principal, one zero-balance product-default Account owned by that Principal, one IdentityBinding from
the proven ExternalIdentity to that Principal, and the consumed registration intent state.

Registration creates no monetary value and no Transaction.

The primitive model permits more than one Account per Principal, but the current product creates one
default Account during registration and exposes no generic Account-management flow in Phase 2.

## Existing binding

If the ExternalIdentity becomes bound before an otherwise valid intent completes, registration
resolves to the existing Principal, creates no duplicate Principal, Account, or binding, and consumes
the intent as a successful single-use completion.

## Session independence

Successful registration does not require creating a persistent user session.

The durable identity result is Principal plus IdentityBinding. The authentication transaction used
to prove the ExternalIdentity is not the long-term identity anchor.
