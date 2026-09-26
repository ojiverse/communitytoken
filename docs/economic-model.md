# Economic Model

The primitive economic model contains Principal, Account, and Transaction.

There are exactly two monetary Transaction kinds: ISSUE and TRANSFER.

ISSUE records the Principal that issued new supply, the destination Account, and the amount.

TRANSFER records source Account, destination Account, and amount.

The ledger does not encode distribution, rewards, campaigns, product roles, or simulation policy as
Transaction kinds.

A Principal may have an application-designated default Account, but default selection is not primitive
Account semantics.

Read the domain specifications for economic state, transitions, identity, and application visibility.
Read the technical specifications for persistence, authentication, registration, idempotency, time,
and transaction consistency.
