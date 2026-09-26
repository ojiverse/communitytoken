# Architecture Decision Records

This directory records durable architectural decisions whose rationale should remain discoverable
after the implementation issue or design discussion is no longer fresh.

ADRs explain why the architecture has a particular shape. They do not replace normative
specifications under docs/specification.

Specifications own domain meaning and boundary invariants. ADRs preserve choices about how those
invariants are exposed or realized.

## Records

- ADR-0001 explains why the trusted application boundary is command/query oriented rather than CRUD.
- ADR-0002 defines the versioned application API namespace.
- ADR-0003 defines Cloudflare service and resource isolation while sharing one account.

Architecture issue #17 is the current high-level primitive-ledger boundary. ADR text must be
interpreted consistently with that issue and the current specifications.
