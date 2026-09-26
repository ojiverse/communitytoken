# Authentication and Delegation

Authentication proves a technical caller or an ExternalIdentity. It does not itself grant arbitrary
application authority.

## OIDC identity proof

When OIDC proves an ExternalIdentity, issuer, signature, audience, lifetime, nonce, and exact subject
must all validate under the configured trust relationship.

Mutable profile claims do not participate in IdentityBinding.

## Technical authority

Adapter authority and administrative authority are distinct.

Possession of adapter authority does not imply permission to ISSUE.

A future feature or simulation service receives only the application authority justified by its
concrete use case.

## Delegated user-facing actions

An authenticated adapter may assert the ExternalIdentity attached to a user-facing action.

CommunityToken resolves that exact identity to a Principal and its application-designated default
Account where required.

The adapter does not obtain reusable internal Principal or Account identifiers as impersonation
credentials.

## Administrative ISSUE

The authenticated administrative authority maps to one stable internal Principal.

That mapping is application-owned. The resulting Principal is passed as the issuer of every
administrative ISSUE and persisted on the Transaction.

The target of administrative ISSUE is resolved from an ExternalIdentity to the target Principal and
that Principal's default Account.

Primitive monetary validity checks existence and arithmetic. It does not decide administrative
authorization.

## Public boundary

There is no unauthenticated interface where an arbitrary caller may submit an ExternalIdentity and act
as its Principal.

Authentication failure and authorization failure remain distinct.

## Sessions

Long-lived sessions, if introduced, remain authentication mechanisms and do not replace Principal and
IdentityBinding as identity truth.
