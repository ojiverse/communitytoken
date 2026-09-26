/**
 * The storage-independent primitive ledger contract for CommunityToken.
 *
 * `defineEconomicContract` registers one suite derived from the invariants and
 * transition rules of the economic-state and economic-transitions
 * specifications: Principal, Account, and Transaction, with ISSUE and TRANSFER
 * as the only monetary kinds. Any storage backend runs the identical suite by
 * supplying an `EconomicHarness`, so the suite — not any implementation — pins
 * the primitive semantics.
 */

/** The two primitive monetary Transaction kinds (economic-state specification). */
export type TransactionKind = "ISSUE" | "TRANSFER";

/** Rejection vocabulary shared by every conforming implementation (economic-transitions specification). */
export type RejectionCode =
	| "INVALID_AMOUNT"
	| "PRINCIPAL_NOT_FOUND"
	| "ACCOUNT_NOT_FOUND"
	| "INSUFFICIENT_BALANCE"
	| "OVERFLOW";

/**
 * A primitive command as the contract suite expresses it. Principal and
 * Account references are the opaque ids the harness returned from
 * `createPrincipal` / `createAccount`, or deliberately unknown ids.
 */
export type HarnessCommand =
	| {
			readonly kind: "ISSUE";
			readonly issuerPrincipalId: string;
			readonly destinationAccountId: string;
			readonly amount: number;
	  }
	| {
			readonly kind: "TRANSFER";
			readonly sourceAccountId: string;
			readonly destinationAccountId: string;
			readonly amount: number;
	  };

export type HarnessResult =
	| { readonly accepted: true; readonly transactionId: string }
	| { readonly accepted: false; readonly code: RejectionCode };

/**
 * One committed Transaction as persisted. An ISSUE carries its issuer
 * Principal and no source; a TRANSFER carries its source Account and no
 * issuer.
 */
export type TransactionView =
	| {
			readonly id: string;
			readonly kind: "ISSUE";
			readonly issuerPrincipalId: string;
			readonly sourceAccountId: null;
			readonly destinationAccountId: string;
			readonly amount: number;
			readonly committedAt: number;
	  }
	| {
			readonly id: string;
			readonly kind: "TRANSFER";
			readonly issuerPrincipalId: null;
			readonly sourceAccountId: string;
			readonly destinationAccountId: string;
			readonly amount: number;
			readonly committedAt: number;
	  };

/**
 * Adaptation surface between the contract suite and one primitive ledger
 * implementation. Implementations may use any storage; only the observable
 * monetary behavior defined here is contracted.
 */
export interface EconomicHarness {
	/**
	 * Returns the implementation to an empty ledger: no Principals the suite
	 * created, no Accounts, no Transactions, zero supply. Pre-existing
	 * application-owned Principals (for example an administrative issuer)
	 * may exist but own no Account with a balance.
	 */
	reset(): Promise<void>;

	/**
	 * Creates a new Principal and returns its opaque id. Creates no Account,
	 * no monetary value, and no Transaction.
	 */
	createPrincipal(): Promise<string>;

	/**
	 * Creates a new zero-balance Account owned by `ownerPrincipalId` and
	 * returns its opaque id. A Principal may own any number of Accounts.
	 * Creates no Transaction.
	 * @throws {Error} when `ownerPrincipalId` names no existing Principal.
	 */
	createAccount(ownerPrincipalId: string): Promise<string>;

	/**
	 * Evaluates a primitive command against current state and commits it
	 * when accepted. A rejected command must leave all observable state
	 * untouched.
	 */
	apply(command: HarnessCommand): Promise<HarnessResult>;

	/**
	 * Returns the current balance of an Account.
	 * @throws {Error} when `accountId` names no existing Account.
	 */
	balanceOf(accountId: string): Promise<number>;

	/** Returns the sum of all Account balances. */
	totalSupply(): Promise<number>;

	/** Returns the sum of amounts over all committed ISSUE Transactions. */
	issuedAmount(): Promise<number>;

	/** Returns every committed Transaction in commit order. */
	transactions(): Promise<readonly TransactionView[]>;
}

/** Builds a fresh harness for one run of the contract suite. */
export type HarnessFactory = () => EconomicHarness;
