# Technical Specifications

Technical specifications define guarantees at system and trust boundaries without fixing a
particular runtime or storage product.

Read the domain specifications first when a change affects monetary or identity meaning.

- Transaction Consistency defines serialization, atomicity, and transaction-scoped capabilities.
- Persistence defines durable structural guarantees and Transaction immutability.
- Temporal Authority defines authoritative mutation time.
- Authentication and Delegation defines identity proof and technical caller boundaries.
- Registration defines one-shot external-identity proof and Principal binding creation.
- Idempotency defines retry equivalence and atomic replay protection.

These documents do not define Cloudflare Worker names, database DDL, source modules, environment
variables, or deployment commands.

The primitive monetary vocabulary used here is Principal, Account, Transaction, ISSUE, and TRANSFER.
