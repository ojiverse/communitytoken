# Economic Model

This file is the compatibility entry point for the current economic specification.

The primitive model contains Principal, Account, and Transaction.

The only monetary Transaction kinds are ISSUE and TRANSFER.

The ledger intentionally does not encode treasury, distribution, peer-to-peer payment, reward,
campaign, actor, or simulation-policy meaning as primitive monetary types.

Read progressively:

- Economic State defines Principal, Account, Transaction, monetary domains, and supply.
- Economic Transitions defines ISSUE, TRANSFER, acceptance, rejection, and self-transfer.
- Identity defines ExternalIdentity and IdentityBinding to Principal.
- Application Authority and Visibility defines authorization and product-visibility rules around the
  primitive ledger.

System-boundary guarantees live under the technical specifications.

The specification index and authority rules are in docs/specification/README.md.
