# Identity

CommunityToken identity is independent of interaction surface and identity provider.

## Principal

Principal is the stable internal identity anchor.

A Principal is not assumed to be a human. It may later represent a non-human or institutional subject
without changing the primitive ledger model.

The economic core does not define Principal subtypes.

## ExternalIdentity

An ExternalIdentity is the exact ordered pair of issuer and subject.

The full pair is the identity key. Subject alone is insufficient.

An external identity value is provider evidence and must not be reused as the internal Principal
identifier.

## IdentityBinding

IdentityBinding associates exactly one ExternalIdentity with exactly one Principal.

No two Principals may be bound to the same ExternalIdentity.

One Principal may have more than one IdentityBinding.

Identity is never inferred from email address, username, display name, avatar, role, or another
mutable profile attribute.

Accounts, Transaction history, and feature or simulation state belong to the internal Principal or
the owning layer, not to mutable external profile data.

## Binding lifecycle

The current domain has no disabled or detached binding state.

A binding either exists and is active, or does not exist.

An existing ExternalIdentity is never silently reassigned to another Principal.

Future unlinking, disabling, merge, or reassignment behavior requires an explicit domain decision.

## Provider independence

Adding another identity provider must not require replacing the Principal or moving its Accounts and
monetary history.

The current beta registers through Discord-backed OIDC, but that product choice does not make
Discord identity part of the Principal definition.

## Sessions

A session is an authentication mechanism, not identity truth.

Creating or destroying a session must not create, replace, merge, or move a Principal or
IdentityBinding.
