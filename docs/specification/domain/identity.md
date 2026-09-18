# Identity

CommunityToken identity is independent of interaction surface and identity provider.

## Concepts

A **User** is the stable internal identity anchor.

An **ExternalIdentity** is the exact ordered pair:

(issuer, subject)

An **IdentityBinding** associates exactly one ExternalIdentity with exactly one User.

A User may have more than one IdentityBinding.

## Invariants

1. A User identifier is not an external subject identifier.
2. An ExternalIdentity is identified by the complete pair (issuer, subject).
3. No two Users may be bound to the same ExternalIdentity.
4. Identity is never inferred from email, username, display name, avatar, role, or other mutable profile data.
5. Wallets, economic history, and feature state belong to the User, not to an ExternalIdentity.
6. Adding another identity provider must not require replacing the User or moving the User's economic state.

Formally, let E be ExternalIdentities and U be Users.

binding: E -> U

is a partial function.

Thus:

for every e in E, there exists at most one u in U such that binding(e) = u.

The inverse relation need not be functional: one User may have multiple bound ExternalIdentities.

## Binding lifecycle

In the current domain, a binding has no disabled or detached state.

A binding either exists and is active, or does not exist.

There is no transition that silently reassigns an existing ExternalIdentity to another User.

Any future unlinking, disabling, or reassignment semantics require a new explicit domain decision.

## Sessions

A session is a surface-specific authentication mechanism, not identity truth.

Creating or destroying a session must not create, replace, merge, or move a User identity.
