# Authentication and Delegation

Authentication proves a technical caller or an ExternalIdentity. It does not itself grant arbitrary
application authority.

## OIDC identity proof

When OIDC proves an ExternalIdentity, acceptance requires the issuer to match the trusted issuer,
the token signature to validate under trusted issuer keys, the intended client to be in the audience,
token lifetime constraints to be valid within the configured tolerance, the nonce to match the
initiating transaction, and the proven subject to be used exactly as issued.

Mutable profile claims do not participate in IdentityBinding.

Key rotation handling must preserve signature trust. An unknown key identifier may justify refreshing
trusted key material. Failure under a known trusted key is not evidence that an unrelated key should
be accepted.

## Technical service authority

Adapter authority and administrative authority are distinct.

Possession of adapter authority does not imply permission to issue supply, distribute from the
application-designated reserve, or inspect administrative reserve state.

A future feature or simulation service receives only the application authority justified by its
concrete use case.

This specification does not predeclare generic plugin roles or a general RBAC framework.

## Delegated user-facing actions

An authenticated adapter may assert the ExternalIdentity attached to a user-facing action.

CommunityToken resolves that exact identity to a Principal and executes the requested application
operation within one trusted boundary.

The adapter does not first obtain an internal Principal identifier and later reuse it as an
impersonation credential.

The application determines which Account the product action may use, such as the resolved
Principal's default Account.

The primitive ledger then evaluates ISSUE or TRANSFER without interpreting the technical caller.

## Administrative monetary actions

Administrative authorization is checked before primitive monetary evaluation.

The fact that ISSUE or TRANSFER would be mathematically valid does not grant permission to request it.

Account ownership or an application role such as reserve likewise does not replace explicit
authorization.

## Public boundary

There is no unauthenticated interface where an arbitrary caller may submit an ExternalIdentity and
act as its Principal.

Authentication failure and authorization failure remain distinct conditions.

## Sessions

Long-lived sessions, if introduced, remain authentication mechanisms.

They do not replace Principal and IdentityBinding as identity truth.
