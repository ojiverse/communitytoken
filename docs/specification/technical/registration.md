# Registration

Registration proves one expected ExternalIdentity and creates or resolves its stable Principal
binding.

It is a one-shot identity-establishment transaction, not a long-lived login session.

## Registration intent

A registration intent fixes one expected ExternalIdentity, one unpredictable correlation state, one
authentication nonce, one proof-key secret, creation time, expiry time, and lifecycle state.

Its lifetime is exactly six hundred seconds.

At most one status-active intent exists for an ExternalIdentity.

Creating a newer intent supersedes an older status-active intent.

## Proof binding

The proven ExternalIdentity must exactly equal the issuer and subject fixed by the registration
intent.

A forwarded registration URL cannot bind a different authenticated subject.

## Single use

An expired, consumed, or superseded intent cannot complete registration.

A failed or mismatched proof does not consume the intent.

Completion rechecks validity and exact identity inside the same serialized boundary that creates or
resolves the binding.

## First successful result

When the ExternalIdentity is not already bound, successful registration atomically creates:

- one Principal;
- one zero-balance Account owned by that Principal;
- one default-Account designation for that Principal;
- one IdentityBinding;
- consumed registration-intent state.

Registration creates no monetary value and no Transaction.

The application invariant is at most one default Account designation per Principal.

## Existing binding

If the identity becomes bound before an otherwise valid intent completes, registration resolves to
the existing Principal and creates no duplicate Principal, Account, default designation, or binding.

## Session independence

Successful registration does not require a persistent user session.

Principal plus IdentityBinding are the durable identity result.
