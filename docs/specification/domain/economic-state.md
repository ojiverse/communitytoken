# Economic State

This document defines the state on which economic transitions operate.

## Entities

A **User** is the stable internal owner of exactly one user wallet.

A **Wallet** holds a token balance and has exactly one of two kinds:

- a user wallet, owned by exactly one User;
- the treasury, the unique system wallet and owned by no User.

An **EconomicOperation** records the semantic reason an accepted economic transition occurred.

A **LedgerTransaction** records the movement associated with one EconomicOperation.

The initiator of an operation is defined separately in
[Actor and Visibility](./actor-and-visibility.md).

## Structural invariants

Let:

- U be the set of Users;
- W be the set of Wallets;
- O be the ordered sequence of EconomicOperations;
- L be the ordered sequence of LedgerTransactions;
- owns: U -> W map each User to the User's wallet;
- kind: W -> {user, system};
- balance: W -> Z.

The following must always hold:

1. There exists exactly one wallet T such that kind(T) = system.
2. T is the treasury.
3. Every User owns exactly one wallet of kind user.
4. No two Users own the same wallet.
5. A wallet of kind system has no User owner.
6. A wallet of kind user has exactly one User owner.
7. Every LedgerTransaction belongs to exactly one EconomicOperation.
8. Every EconomicOperation has exactly one LedgerTransaction under the current economic model.
9. Existing economic history is never rewritten to express a later correction.

## Monetary domains

Let M = 2^53 - 1.

TokenAmount = { a in Z | 1 <= a <= M }

WalletBalance = { b in Z | 0 <= b <= M }

TotalSupply = { s in Z | 0 <= s <= M }

Every operation amount belongs to TokenAmount.

Every wallet balance belongs to WalletBalance.

## Supply

Define:

supply(S) = sum of balance(w) for every w in W

issued(S) =
  sum of the amount of every LedgerTransaction whose operation kind is TOKEN_ISSUANCE

The accounting invariant is:

issued(S) = supply(S)

and:

supply(S) belongs to TotalSupply.

The treasury balance is part of supply. Tokens held by the treasury are issued but not circulating
among users.

## Initial economic state

The initial economic state contains the treasury with balance zero and no economic history.

Creating a User creates one user wallet with balance zero. User creation does not create an
EconomicOperation or LedgerTransaction and does not change supply.
