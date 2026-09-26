# Economic Transitions

Monetary state changes only through accepted ISSUE or TRANSFER Transactions.

## ISSUE

ISSUE credits a positive integer amount to one existing destination Account.

An accepted ISSUE increases the destination balance and total supply by exactly the same amount.

ISSUE is the only primitive that may increase total supply.

The destination Account has no required institutional role. The ledger does not require it to be a
treasury, reserve, community, system, or user Account.

Authorization to request ISSUE is determined outside primitive monetary validity.

## TRANSFER

TRANSFER moves a positive integer amount from one existing source Account to one existing destination
Account.

An accepted TRANSFER decreases the source balance and increases the destination balance by the same
amount.

TRANSFER does not change total supply.

The source must hold at least the requested amount before the transition.

The ledger does not distinguish distribution, peer-to-peer payment, treasury payment, reward,
compensation, escrow movement, or another higher-level reason. Those meanings belong to the
application, feature, or simulation that requested the TRANSFER.

## Acceptance

An ISSUE is accepted only when the amount is inside the monetary domain, the destination Account
exists, the resulting destination balance is valid, and the resulting total supply is valid.

A TRANSFER is accepted only when the amount is inside the monetary domain, both Accounts exist, the
source has sufficient balance, and every resulting balance remains valid.

Account ownership role and Principal classification are not acceptance conditions.

Authorization is not inferred from monetary validity.

## Self-transfer

A TRANSFER may use the same Account as both source and destination.

The source must still hold at least the requested amount before the transition.

The net balance change is zero, total supply is unchanged, and one immutable Transaction is still
recorded.

Self-transfer is therefore a monetary event with no net balance effect, not a rejected no-op.

## Atomic result

An accepted primitive transition commits the Transaction and every required balance change as one
indivisible result.

There is no valid observable state where the Transaction exists without its required balance effect,
or where the balance effect exists without the Transaction.

Application state such as idempotency or feature-owned records may be composed in the same outer
atomic section when its correctness depends on that primitive transition.

## Rejection

A rejected ISSUE or TRANSFER creates no Transaction and changes no balance.

Insufficient funds, missing Accounts, invalid amount, or overflow are rejections rather than partial
success.

Higher-level application rejection may occur before the primitive transition is evaluated. Such
authorization or policy rejection is outside the monetary transition itself.
