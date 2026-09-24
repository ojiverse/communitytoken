# Authentication and Delegation

Authentication proves a principal or ExternalIdentity. It does not itself grant arbitrary authority.

## OIDC identity proof

When OIDC is used to prove an ExternalIdentity, acceptance requires all of the following:

1. the issuer is exactly the trusted issuer for the configured identity relationship;
2. the token signature is valid under a trusted key of that issuer;
3. the intended client is included in the audience;
4. token lifetime constraints are valid with a fixed maximum clock-skew tolerance of 60 seconds;
5. the nonce matches the initiating authentication transaction;
6. the proven subject is used exactly as issued.

Mutable profile claims do not participate in identity binding.

Key rotation handling must preserve signature trust: an unknown key identifier may cause trust
material to be refreshed, but a signature failure under a known trusted key is not evidence that a
different key should be tried.

## Service principals

Adapter delegation and administrative authority are distinct service principals.

Possession of adapter authority does not imply administrative authority.

Administrative capabilities include explicit issuance, treasury distribution, and treasury
inspection.

A generic service principal cannot express those administrative operations.

A future feature-specific service must receive only the authority justified by its concrete core use
case. This specification does not predeclare a plugin role, generic RBAC model, or delegated treasury
capability.

## User actions through adapters

An authenticated adapter may assert the ExternalIdentity attached to a user action.

The trusted core resolves that ExternalIdentity to a User and executes the requested operation in one
delegation boundary.

The adapter is not the actor of a user-initiated economic operation; the resolved User is.

There is no two-step protocol in which an adapter first obtains an internal User identifier and then
uses that identifier as an impersonation credential.

This delegation rule applies to operations for which the User is actually the authorized actor. It
does not convert a User action at an external feature surface into User authority over treasury
operations.

## Public boundary

There is no unauthenticated interface where an arbitrary caller can submit an ExternalIdentity and
act as its User.

Authentication failure and authorization failure are distinct conditions.

## Sessions

Long-lived surface sessions, if introduced, remain authentication mechanisms. They do not replace
the User/IdentityBinding model as identity truth.
