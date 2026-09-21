# Registration

Registration proves one expected ExternalIdentity and creates or resolves its stable User binding.

It is a one-shot transaction, not a long-lived login session.

## Registration intent

A registration intent fixes:

- one expected ExternalIdentity;
- one unpredictable correlation state;
- one authentication nonce;
- one proof-key secret;
- a creation time;
- an expiry time;
- a lifecycle state.

Its lifetime is exactly 600 seconds.

At most one status-active intent exists for an ExternalIdentity.

Lifecycle status and temporal validity are distinct: an intent can still have status active after its
expiry time, but an expired intent is unusable.

Creating a newer intent for the same ExternalIdentity supersedes any older status-active intent,
including one that is already expired.

## Proof binding

The ExternalIdentity proven by authentication must equal the ExternalIdentity fixed when the
registration intent was created.

In particular:

verified_issuer = expected_issuer

and:

verified_subject = expected_subject

Possession of a forwarded registration URL therefore cannot bind a different authenticated subject.

## Single use

An expired, consumed, or superseded intent cannot complete registration.

A failed or mismatched identity proof does not consume the intent. The intended subject may retry
while the same intent remains active and unexpired.

Completion rechecks intent validity and exact identity equality at the same serialized boundary that
creates or resolves the identity binding.

## Atomic result

A first successful registration creates, as one indivisible result:

- one stable User;
- one zero-balance user wallet owned by that User;
- one IdentityBinding from the proven ExternalIdentity to that User;
- the consumed registration intent.

Registration itself creates no economic movement.

If the ExternalIdentity becomes bound before an otherwise valid intent completes, registration
resolves to the existing User, creates no additional binding or wallet, and still consumes that
intent as the successful single-use completion.

## Session independence

Successful registration does not require creating a persistent user session.

The durable result is the User and IdentityBinding, not the authentication transaction used to prove
them.
