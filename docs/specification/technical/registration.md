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

At most one unconsumed active intent exists for an ExternalIdentity.

Creating a newer intent for the same ExternalIdentity supersedes the older unused intent.

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

Completion rechecks intent validity at the same serialized boundary that creates or resolves the
identity binding.

## Atomic result

A first successful registration creates, as one indivisible result:

- one stable User;
- one zero-balance user wallet owned by that User;
- one IdentityBinding from the proven ExternalIdentity to that User;
- the consumed registration intent.

Registration itself creates no economic movement.

If the ExternalIdentity is already bound, registration resolves to the existing User and does not
create another binding or wallet.

## Session independence

Successful registration does not require creating a persistent user session.

The durable result is the User and IdentityBinding, not the authentication transaction used to prove
them.
