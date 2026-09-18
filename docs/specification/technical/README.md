# Technical Specifications

Technical specifications define guarantees at system and trust boundaries without fixing a
particular implementation mechanism.

Read the domain specifications first when the behavior has product meaning.

- [Transaction Consistency](./transaction-consistency.md) — serialization, atomicity, and scoped transaction capability.
- [Persistence](./persistence.md) — durable structural guarantees and history immutability.
- [Temporal Authority](./temporal-authority.md) — authoritative transaction time.
- [Authentication and Delegation](./authentication-and-delegation.md) — authenticated identities and principal boundaries.
- [Registration](./registration.md) — one-shot external-identity proof and binding creation.
- [Idempotency](./idempotency.md) — retry equivalence and atomic replay protection.

These documents intentionally do not name runtime products, database engines, source-code modules,
routes, environment variables, or deployment procedures.
