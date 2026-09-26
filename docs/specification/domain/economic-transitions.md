# Economic Transitions

Monetary state changes only through accepted ISSUE or TRANSFER Transactions.

## ISSUE

ISSUE creates new supply and credits one existing destination Account.

The request identifies an issuer Principal, destination Account, and positive integer amount.

An accepted ISSUE increases destination balance and total supply by exactly the amount and persists
the issuer Principal on the Transaction.

The issuer Principal must exist.

The primitive ledger does not decide whether that Principal is authorized to issue. Authorization
and mapping from an authenticated caller to the issuer Principal occur at the application boundary.

The destination Account has no required role.

## TRANSFER

TRANSFER moves a positive integer amount from one existing source Account to one existing destination
Account.

An accepted TRANSFER decreases source balance and increases destination balance by the same amount.

TRANSFER does not change total supply.

The source must hold at least the requested amount before the transition.

The ledger does not distinguish distribution, peer-to-peer payment, reward, compensation, or another
higher-level reason.

## Acceptance

ISSUE is accepted only when the issuer Principal and destination Account exist, amount is valid, and
the resulting destination balance and total supply remain valid.

TRANSFER is accepted only when both Accounts exist, amount is valid, source has sufficient balance,
and resulting balances remain valid.

Authorization is not inferred from monetary validity.

## Self-transfer

A TRANSFER may use the same Account as source and destination.

The source must still hold at least the requested amount before the transition.

Net balance change is zero, total supply is unchanged, and one immutable Transaction is recorded.

## Atomic result

An accepted primitive transition commits the Transaction and every required balance change as one
indivisible result.

Application state such as idempotency may be composed in the same outer atomic section when
correctness requires it.

## Rejection

A rejected ISSUE or TRANSFER creates no Transaction and changes no balance.

Missing Principal or Account, invalid amount, insufficient funds, and overflow are rejections rather
than partial success.
