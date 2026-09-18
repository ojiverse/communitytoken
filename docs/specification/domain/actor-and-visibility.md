# Actor and Visibility

The actor of an operation answers who caused the operation. It is independent of which wallet funds
the movement.

## Actor

An actor is exactly one of:

- a User;
- a service principal;
- the system.

A User actor carries a User identifier.

A service actor carries a service-principal identifier.

A system actor carries no identifier.

The actor is audit and application context. It is not an input to economic validity and must not be
derived from the source wallet.

Examples of the distinction:

- a User-to-User transfer has the sending User as actor;
- a User claiming a treasury-funded reward has the claiming User as actor while the treasury is the source;
- an administrative distribution has an administrative service as actor while the treasury is the source.

For a user-initiated action received through an adapter, the adapter itself is not the actor. The
resolved User is.

## Visibility

Normal User visibility is self-only.

A User may observe:

- the balance of the User's own wallet;
- economic history whose ledger movement involves the User's own wallet.

A normal User may not observe another User's balance or history merely by knowing an identifier.

Treasury inspection is an administrative capability, separate from normal User visibility.

## History direction

History direction is relative to the wallet being viewed.

For a movement touching that wallet:

- in means value arrives at the wallet;
- out means value leaves the wallet;
- self means a P2P movement has the same wallet as source and destination.

A self-transfer appears once in that wallet's history.

TOKEN_ISSUANCE is incoming in treasury history even though its source and destination both name the
treasury, because its semantic effect is a credit.

## Counterparty

For a User history entry, the counterparty is the User owning the other user wallet or the treasury.

For a P2P self-transfer, the counterparty is the same User.

History interpretation must be derived from the operation and ledger relation; it must not invent a
second economic meaning.
