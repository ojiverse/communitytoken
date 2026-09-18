# Economic Transitions

Economic state changes only through accepted economic operations.

## Operation kinds

The economic model defines these semantic kinds:

| Kind | Source | Destination | Supply effect |
| --- | --- | --- | --- |
| TOKEN_ISSUANCE | treasury | treasury | increases by amount |
| DISTRIBUTION | treasury | user | unchanged |
| P2P_TRANSFER | user | user | unchanged |
| TREASURY_PAYMENT | user | treasury | unchanged |
| DAILY_REWARD | treasury | user | unchanged |

Daily Reward eligibility is defined separately in
[Daily Reward](./daily-reward.md).

## Transition relation

Let a command be:

C = (kind, from, to, amount, metadata)

Evaluation defines a partial transition:

S --C--> S'

An accepted command produces S'. A rejected command produces no committed transition.

Common acceptance conditions are:

1. amount belongs to TokenAmount;
2. from and to designate existing wallets;
3. the wallet kinds match the direction admitted by C.kind;
4. every resulting wallet balance belongs to WalletBalance;
5. the resulting total supply belongs to TotalSupply;
6. for every non-issuance operation, the source has at least amount before the transition.

## Balance deltas

Let Delta_C(w) be the balance delta for wallet w.

For TOKEN_ISSUANCE:

Delta_C(T) = +amount

and Delta_C(w) = 0 for every w != T.

For every non-issuance operation:

Delta_C(w) =
  -amount * [w = from]
  +amount * [w = to]

where [P] is 1 when P is true and 0 otherwise.

The resulting balance is:

balance'(w) = balance(w) + Delta_C(w)

## Self-transfer

A P2P transfer may have from = to.

Its balance delta is:

-amount + amount = 0

It is therefore valid when all other preconditions hold, changes no balance, and still records one
EconomicOperation and one LedgerTransaction.

## Issuance

TOKEN_ISSUANCE is the only transition that may increase supply.

It credits the treasury without a corresponding debit. The treasury-to-treasury ledger relation
records the movement identity; the operation kind gives it credit-only semantics.

## Atomic semantic result

For an accepted command, the following form one economic transition:

- all required balance changes;
- one EconomicOperation;
- one LedgerTransaction.

There is no valid observable state in which only a proper subset of those effects exists.

## Rejection

Rejection leaves no trace.

If any precondition fails:

S' = S

No balance changes, EconomicOperation, or LedgerTransaction are created.

This applies equally to invalid amount, missing wallet, invalid direction, insufficient source
balance, and overflow.
