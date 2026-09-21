import { DurableObject } from "cloudflare:workers";
import {
	type Actor,
	ADMIN_API_PRINCIPAL,
	type AdminActor,
	applyEconomicCommand as applyEconomicCommandOperation,
	type BalanceResult,
	type Clock,
	type CommunityTokenApplication,
	type CompleteRegistrationOutcome,
	completeRegistration as completeRegistrationOperation,
	createCommunityTokenApplication,
	createRegistrationIntent as createRegistrationIntentOperation,
	type DistributeTokenInput,
	distributeToken as distributeTokenOperation,
	type EconomicSelectorCommand,
	executeIdempotent,
	getBalance as getBalanceOperation,
	getTransactionHistory as getTransactionHistoryOperation,
	type HistoryEntry,
	type HistoryRequest,
	type IdempotentExecution,
	type IssueTokenInput,
	issueToken as issueTokenOperation,
	type OperationAccepted,
	type Page,
	type PayTreasuryInput,
	type PayTreasuryResult,
	TREASURY_SELECTOR,
	type TransferTokenInput,
	type TransferTokenResult,
	transferToken as transferTokenOperation,
	type UnitOfWork,
	type UseCaseError,
	type UseCaseResult,
	type UserActor,
	userSelector,
	type WalletSelector,
} from "@communitytoken/application";
import { TREASURY_WALLET_ID } from "@communitytoken/economic-kernel";
import { DISCORD_ADAPTER_PRINCIPAL, type ServicePrincipal } from "./auth";
import { SCHEMA } from "./schema";
import { createStorageUnitOfWork } from "./unit-of-work";

/** Raw `economic_operations` row as returned by `listOperations`. */
export type OperationRow = {
	readonly id: string;
	readonly kind: string;
	readonly metadata: string | null;
	readonly actor_kind: string;
	readonly actor_id: string | null;
	readonly created_at: number;
};

/** Raw `ledger_transactions` row as returned by `listLedger`. */
export type LedgerRow = {
	readonly id: string;
	readonly operation_id: string;
	readonly from_wallet_id: string;
	readonly to_wallet_id: string;
	readonly amount: number;
	readonly created_at: number;
};

/**
 * Result of the test-support user registration. A duplicate is an expected
 * failure and surfaces as a returned value, not a thrown RPC rejection —
 * matching the UseCaseResult convention and keeping expected failures from
 * surfacing as remote unhandled rejections in the test pool.
 */
export type CreateUserResult =
	| { readonly ok: true }
	| { readonly ok: false; readonly error: string };

/** A JSON-serializable value — the shape every route response body takes. */
export type JsonValue =
	| string
	| number
	| boolean
	| null
	| readonly JsonValue[]
	| { readonly [key: string]: JsonValue };

/**
 * A serializable route outcome (issue #4 PR-3): the HTTP status plus JSON
 * body the Worker forwards verbatim. Expected failures are descriptors,
 * never throws; unexpected storage/contract/runtime failures throw and the
 * Worker maps the rejection to `500 internal_error`.
 */
export type RouteResponse = {
	readonly status: number;
	readonly body: JsonValue;
};

/** An exact external identity pair, already wire-validated by the Worker. */
export type ExternalIdentity = {
	readonly issuer: string;
	readonly subject: string;
};

/**
 * The caller-computed idempotency inputs for `POST /api/v1/transfers`:
 * the verbatim `Idempotency-Key` header value plus the fingerprint the
 * Worker computed (SHA-256 is async, so it cannot run inside the
 * synchronous section).
 */
export type IdempotencyParams = {
	readonly key: string;
	readonly fingerprintVersion: string;
	readonly requestFingerprint: string;
};

/** Wire input of `POST /api/v1/history`, wire-validated by the Worker. */
export type InternalHistoryInput = ExternalIdentity & {
	readonly cursor?: string;
	readonly limit?: number;
};

/** Wire input of `POST /api/v1/transfers`, wire-validated by the Worker. */
export type InternalTransferInput = {
	readonly from: ExternalIdentity;
	readonly to: ExternalIdentity;
	readonly amount: number;
};

/** Wire input of `POST /api/v1/admin/issuances`, wire-validated by the Worker. */
export type AdminIssueInput = {
	readonly amount: number;
	readonly metadata?: string;
};

/** Wire input of `POST /api/v1/admin/distributions`, wire-validated by the Worker. */
export type AdminDistributeInput = ExternalIdentity & {
	readonly amount: number;
	readonly metadata?: string;
};

/** Query input of `GET /api/v1/admin/treasury/history`, validated by the Worker. */
export type AdminTreasuryHistoryInput = {
	readonly cursor?: string;
	readonly limit?: number;
};

/**
 * The unguessable registration material the Worker generates before the
 * serialized creation section (issue #4 PR-4): the correlation `state`,
 * the authentication `nonce`, the provider-independent `proofKeySecret`
 * (persisted in the `pkce_verifier` column — OIDC/PKCE naming does not
 * cross into the application layer), and the authorization URL whose
 * verbatim bytes the replay record stores. The OIDC client secret is
 * deliberately absent: it never crosses a DO boundary.
 */
export type RegistrationProofMaterial = {
	readonly state: string;
	readonly nonce: string;
	readonly proofKeySecret: string;
	readonly authorizationUrl: string;
};

/**
 * What the public callback's synchronous intent read returns (issue #4
 * PR-4): the proof material needed to continue the OIDC exchange — the
 * expected external identity, the authentication `nonce`, and the
 * `proofKeySecret` presented as `code_verifier` — or `unavailable` for a
 * missing, non-active, or expired intent (the callback maps that to the
 * 410 expired-link page without further OIDC work).
 */
export type OidcRegistrationIntentRead =
	| {
			readonly type: "active";
			readonly expectedIssuer: string;
			readonly expectedSubject: string;
			readonly nonce: string;
			readonly proofKeySecret: string;
	  }
	| { readonly type: "unavailable" };

/**
 * The external identity the Worker proved via ID-token verification and
 * presents to the completion section for the exact re-check.
 */
export type VerifiedIdentity = {
	readonly issuer: string;
	readonly subject: string;
};

/** Builds the fixed error body `{error, error_description}`. */
function errorDescriptor(
	status: number,
	code: string,
	description: string,
): RouteResponse {
	return {
		status,
		body: { error: code, error_description: description },
	};
}

/**
 * Maps an expected use-case failure onto the fixed HTTP taxonomy: a
 * forbidden actor is `403 forbidden`, a kernel rejection is `422` with the
 * lowercased rejection code, and an input-contract violation is `400` with
 * the lowercased code (`INVALID_LIMIT` -> `invalid_limit`).
 */
function useCaseErrorDescriptor(error: UseCaseError): RouteResponse {
	switch (error.type) {
		case "forbidden":
			return errorDescriptor(403, "forbidden", error.detail);
		case "rejected":
			return errorDescriptor(422, error.code.toLowerCase(), error.detail);
		case "invalid-input":
			return errorDescriptor(400, error.code.toLowerCase(), error.detail);
	}
}

/**
 * The fixed snake_case history entry shape of the HTTP response contract
 * (`operations` array elements).
 */
function serializeHistoryEntry(entry: HistoryEntry): JsonValue {
	return {
		id: entry.id,
		kind: entry.kind,
		amount: entry.amount,
		from_wallet_id: entry.fromWalletId,
		to_wallet_id: entry.toWalletId,
		metadata: entry.metadata,
		actor_kind: entry.actorKind,
		actor_id: entry.actorId,
		created_at: entry.createdAt,
		direction: entry.direction,
		counterparty: entry.counterparty,
	};
}

/** The `{operations, next_cursor}` body of a history route. */
function historyDescriptor(page: Page<HistoryEntry>): RouteResponse {
	return {
		status: 200,
		body: {
			operations: page.entries.map(serializeHistoryEntry),
			next_cursor: page.nextCursor,
		},
	};
}

/**
 * Rehydrates a stored replay descriptor (`stored_result =
 * JSON.stringify({status, body})`). A record that fails to parse or lacks
 * the descriptor shape is an unexpected persistence failure — thrown, so
 * the Worker maps it to `500 internal_error` rather than recomputing the
 * mutation.
 */
function parseStoredResult(storedResult: string): RouteResponse {
	const parsed: unknown = JSON.parse(storedResult);
	if (
		typeof parsed !== "object" ||
		parsed === null ||
		typeof (parsed as { status?: unknown }).status !== "number" ||
		!("body" in parsed)
	) {
		throw new Error("corrupt idempotency stored_result");
	}
	return parsed as RouteResponse;
}

/**
 * The production CommunityState Durable Object (issue #4 PR-2): the single
 * serialization authority for one community's durable economic state.
 * The deployment dereferences exactly one instance via
 * `idFromName("community")`.
 *
 * All mutable state lives in `ctx.storage.sql`; the DO keeps no cached
 * state in instance fields, so object eviction/restart cannot lose
 * committed data. Schema initialization runs under
 * `blockConcurrencyWhile` before any RPC can execute.
 *
 * The RPC surface has three tiers:
 *
 *   - the seven route-facing methods (`internalBalance`,
 *     `internalHistory`, `internalTransfer`, `adminIssue`,
 *     `adminDistribute`, `adminTreasuryBalance`, `adminTreasuryHistory`) —
 *     the PR-3 trusted core API. Each receives the Worker's asserted
 *     service principal (never bearer bytes), re-checks it against its
 *     route group as a misroute backstop, owns the complete
 *     `uow.transact` section — identity resolution, the protected
 *     mutation, and its idempotency record commit together — and returns
 *     serializable `{status, body}` descriptors;
 *   - the six product use-case methods (`issueToken`, `distributeToken`,
 *     `transferToken`, `payTreasury`, `getBalance`,
 *     `getTransactionHistory`) — the facade entries kept for the contract
 *     harness; each opens its own section;
 *   - test-support methods (`createUser`, `createBoundUser`,
 *     `applyEconomicCommand`, `listOperations`, `listLedger`,
 *     `issuedAmount`, `totalSupply`) for the unchanged Phase 1 contract
 *     harness — unreachable from the Worker's `fetch()`.
 */
export class CommunityState extends DurableObject {
	private readonly uow: UnitOfWork;
	private readonly app: CommunityTokenApplication;

	/**
	 * The clock authority behind the UnitOfWork's per-section sample. The
	 * production value is `Date.now()`; the field is the injection seam
	 * deterministic tests replace (request-supplied timestamps are never
	 * accepted).
	 */
	clock: Clock = { nowMs: () => Date.now() };

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		ctx.blockConcurrencyWhile(async () => {
			ctx.storage.sql.exec(SCHEMA);
			this.ensureTreasury();
		});
		this.uow = createStorageUnitOfWork(ctx.storage, {
			nowMs: () => this.clock.nowMs(),
		});
		this.app = createCommunityTokenApplication({ uow: this.uow });
	}

	/**
	 * Seeds the deployment's single system wallet at construction time.
	 * The treasury id is the kernel's well-known identifier; its balance
	 * starts at zero — initial funding is an explicit TOKEN_ISSUANCE, not
	 * a hidden seed.
	 */
	private ensureTreasury(): void {
		const found = this.ctx.storage.sql
			.exec("SELECT id FROM wallets WHERE id = ?", TREASURY_WALLET_ID)
			.toArray();
		if (found.length === 0) {
			const t = this.clock.nowMs();
			this.ctx.storage.sql.exec(
				"INSERT INTO wallets (id, kind, owner_user_id, balance, created_at, updated_at) VALUES (?, 'system', NULL, 0, ?, ?)",
				TREASURY_WALLET_ID,
				t,
				t,
			);
		}
	}

	// ---- Product use-case methods ------------------------------------

	issueToken(
		actor: AdminActor,
		input: IssueTokenInput,
	): UseCaseResult<OperationAccepted> {
		return this.app.issueToken(actor, input);
	}

	distributeToken(
		actor: AdminActor,
		input: DistributeTokenInput,
	): UseCaseResult<OperationAccepted> {
		return this.app.distributeToken(actor, input);
	}

	transferToken(
		actor: UserActor,
		input: TransferTokenInput,
	): UseCaseResult<TransferTokenResult> {
		return this.app.transferToken(actor, input);
	}

	payTreasury(
		actor: UserActor,
		input: PayTreasuryInput,
	): UseCaseResult<PayTreasuryResult> {
		return this.app.payTreasury(actor, input);
	}

	getBalance(
		actor: Actor,
		selector: WalletSelector,
	): UseCaseResult<BalanceResult> {
		// The facade's overloads pin actor to selector for typed callers;
		// the use-case guards re-check the pairing at runtime.
		return selector.type === "treasury"
			? this.app.getBalance(actor as AdminActor, selector)
			: this.app.getBalance(actor as UserActor, selector);
	}

	getTransactionHistory(
		actor: Actor,
		selector: WalletSelector,
		request: HistoryRequest,
	): UseCaseResult<Page<HistoryEntry>> {
		return selector.type === "treasury"
			? this.app.getTransactionHistory(actor as AdminActor, selector, request)
			: this.app.getTransactionHistory(actor as UserActor, selector, request);
	}

	// ---- Route-facing methods (PR-3 trusted core API) -----------------
	//
	// Each method corresponds to one fixed Worker route, receives the
	// asserted service principal (never a bearer credential), re-checks it
	// against the route group as a misroute backstop, and owns its complete
	// serialized section: identity resolution and the protected mutation
	// — plus its idempotency record for the transfer route — commit
	// atomically. Expected outcomes are `{status, body}` descriptors;
	// unexpected failures throw and surface as `500 internal_error`.

	/**
	 * `POST /api/v1/balance`: the bound user's own balance under
	 * self-only visibility — the adapter supplies only the external
	 * identity; the resolved internal User is the actor.
	 */
	internalBalance(
		principal: ServicePrincipal,
		input: ExternalIdentity,
	): RouteResponse {
		if (principal !== DISCORD_ADAPTER_PRINCIPAL) {
			return errorDescriptor(
				403,
				"forbidden",
				`route requires the ${DISCORD_ADAPTER_PRINCIPAL} principal`,
			);
		}
		return this.uow.transact((ctx) => {
			const userId = ctx.identityBindings.findUserIdByExternal(
				input.issuer,
				input.subject,
			);
			if (userId === undefined) {
				return errorDescriptor(
					404,
					"identity_not_bound",
					`no identity binding for ${input.issuer}:${input.subject}`,
				);
			}
			const result = getBalanceOperation(
				ctx,
				{ kind: "user", userId },
				userSelector(userId),
			);
			return result.ok
				? { status: 200, body: { balance: result.value.balance } }
				: useCaseErrorDescriptor(result.error);
		});
	}

	/**
	 * `POST /api/v1/history`: newest-first cursor-paginated history of
	 * the bound user's own wallet — same visibility rule as the balance.
	 */
	internalHistory(
		principal: ServicePrincipal,
		input: InternalHistoryInput,
	): RouteResponse {
		if (principal !== DISCORD_ADAPTER_PRINCIPAL) {
			return errorDescriptor(
				403,
				"forbidden",
				`route requires the ${DISCORD_ADAPTER_PRINCIPAL} principal`,
			);
		}
		return this.uow.transact((ctx) => {
			const userId = ctx.identityBindings.findUserIdByExternal(
				input.issuer,
				input.subject,
			);
			if (userId === undefined) {
				return errorDescriptor(
					404,
					"identity_not_bound",
					`no identity binding for ${input.issuer}:${input.subject}`,
				);
			}
			const result = getTransactionHistoryOperation(
				ctx,
				{ kind: "user", userId },
				userSelector(userId),
				{
					cursor: input.cursor ?? null,
					...(input.limit === undefined ? {} : { limit: input.limit }),
				},
			);
			return result.ok
				? historyDescriptor(result.value)
				: useCaseErrorDescriptor(result.error);
		});
	}

	/**
	 * `POST /api/v1/transfers`: the idempotency-protected P2P transfer.
	 * The serialized section runs the fixed choreography — idempotency
	 * lookup, sender resolution, recipient resolution, use case, record
	 * insert — so a successful transfer and its replay record commit
	 * atomically. Expected non-mutating failures (unbound identities,
	 * kernel rejections) record nothing and leave the key retryable.
	 */
	internalTransfer(
		principal: ServicePrincipal,
		idempotency: IdempotencyParams,
		input: InternalTransferInput,
	): RouteResponse {
		if (principal !== DISCORD_ADAPTER_PRINCIPAL) {
			return errorDescriptor(
				403,
				"forbidden",
				`route requires the ${DISCORD_ADAPTER_PRINCIPAL} principal`,
			);
		}
		return this.uow.transact((ctx) => {
			const outcome = executeIdempotent(
				ctx,
				{
					servicePrincipal: principal,
					idempotencyKey: idempotency.key,
					fingerprintVersion: idempotency.fingerprintVersion,
					requestFingerprint: idempotency.requestFingerprint,
				},
				(): IdempotentExecution<RouteResponse> => {
					const sender = ctx.identityBindings.findUserIdByExternal(
						input.from.issuer,
						input.from.subject,
					);
					if (sender === undefined) {
						return {
							record: false,
							result: errorDescriptor(
								404,
								"identity_not_bound",
								`no identity binding for ${input.from.issuer}:${input.from.subject}`,
							),
						};
					}
					const recipient = ctx.identityBindings.findUserIdByExternal(
						input.to.issuer,
						input.to.subject,
					);
					if (recipient === undefined) {
						return {
							record: false,
							result: errorDescriptor(
								404,
								"recipient_not_bound",
								`no identity binding for ${input.to.issuer}:${input.to.subject}`,
							),
						};
					}
					const result = transferTokenOperation(
						ctx,
						{ kind: "user", userId: sender },
						{ toUserId: recipient, amount: input.amount },
					);
					if (!result.ok) {
						return {
							record: false,
							result: useCaseErrorDescriptor(result.error),
						};
					}
					const descriptor: RouteResponse = {
						status: 200,
						body: {
							operation_id: result.value.operationId,
							from_balance: result.value.fromBalance,
						},
					};
					return {
						record: true,
						result: descriptor,
						storedResult: JSON.stringify(descriptor),
					};
				},
			);
			switch (outcome.type) {
				case "replayed":
					return parseStoredResult(outcome.storedResult);
				case "conflict":
					return errorDescriptor(
						409,
						"idempotency_key_reuse",
						"the idempotency key was already used with a different request",
					);
				case "executed":
					return outcome.result;
			}
		});
	}

	/**
	 * `POST /api/v1/admin/issuances`: explicit `TOKEN_ISSUANCE` into the
	 * treasury; the `admin-api` check at the route group is backstopped by
	 * the use case's `requireAdmin` guard.
	 */
	adminIssue(
		principal: ServicePrincipal,
		input: AdminIssueInput,
	): RouteResponse {
		if (principal !== ADMIN_API_PRINCIPAL) {
			return errorDescriptor(
				403,
				"forbidden",
				`route requires the ${ADMIN_API_PRINCIPAL} principal`,
			);
		}
		const actor: AdminActor = { kind: "service", principalId: principal };
		return this.uow.transact((ctx) => {
			const result = issueTokenOperation(ctx, actor, {
				amount: input.amount,
				...(input.metadata === undefined ? {} : { metadata: input.metadata }),
			});
			return result.ok
				? { status: 200, body: { operation_id: result.value.operationId } }
				: useCaseErrorDescriptor(result.error);
		});
	}

	/**
	 * `POST /api/v1/admin/distributions`: `DISTRIBUTION` of treasury reserve to
	 * the user bound to the given external identity — the internal User id
	 * is never exposed to the operator.
	 */
	adminDistribute(
		principal: ServicePrincipal,
		input: AdminDistributeInput,
	): RouteResponse {
		if (principal !== ADMIN_API_PRINCIPAL) {
			return errorDescriptor(
				403,
				"forbidden",
				`route requires the ${ADMIN_API_PRINCIPAL} principal`,
			);
		}
		const actor: AdminActor = { kind: "service", principalId: principal };
		return this.uow.transact((ctx) => {
			const userId = ctx.identityBindings.findUserIdByExternal(
				input.issuer,
				input.subject,
			);
			if (userId === undefined) {
				return errorDescriptor(
					404,
					"identity_not_bound",
					`no identity binding for ${input.issuer}:${input.subject}`,
				);
			}
			const result = distributeTokenOperation(ctx, actor, {
				toUserId: userId,
				amount: input.amount,
				...(input.metadata === undefined ? {} : { metadata: input.metadata }),
			});
			return result.ok
				? { status: 200, body: { operation_id: result.value.operationId } }
				: useCaseErrorDescriptor(result.error);
		});
	}

	/** `GET /api/v1/admin/treasury/balance`: administrative treasury balance. */
	adminTreasuryBalance(principal: ServicePrincipal): RouteResponse {
		if (principal !== ADMIN_API_PRINCIPAL) {
			return errorDescriptor(
				403,
				"forbidden",
				`route requires the ${ADMIN_API_PRINCIPAL} principal`,
			);
		}
		const actor: AdminActor = { kind: "service", principalId: principal };
		return this.uow.transact((ctx) => {
			const result = getBalanceOperation(ctx, actor, TREASURY_SELECTOR);
			return result.ok
				? { status: 200, body: { balance: result.value.balance } }
				: useCaseErrorDescriptor(result.error);
		});
	}

	/**
	 * `GET /api/v1/admin/treasury/history`: newest-first cursor-paginated
	 * treasury history, including issuances — administrative inspection.
	 */
	adminTreasuryHistory(
		principal: ServicePrincipal,
		input: AdminTreasuryHistoryInput,
	): RouteResponse {
		if (principal !== ADMIN_API_PRINCIPAL) {
			return errorDescriptor(
				403,
				"forbidden",
				`route requires the ${ADMIN_API_PRINCIPAL} principal`,
			);
		}
		const actor: AdminActor = { kind: "service", principalId: principal };
		return this.uow.transact((ctx) => {
			const result = getTransactionHistoryOperation(
				ctx,
				actor,
				TREASURY_SELECTOR,
				{
					cursor: input.cursor ?? null,
					...(input.limit === undefined ? {} : { limit: input.limit }),
				},
			);
			return result.ok
				? historyDescriptor(result.value)
				: useCaseErrorDescriptor(result.error);
		});
	}

	/**
	 * `POST /api/v1/registration-intents` (issue #4 PR-4): the
	 * idempotency-protected intent creation. One serialized section runs
	 * the fixed choreography — idempotency lookup, binding lookup,
	 * supersede, intent insert, replay-record insert — so a created intent
	 * and its stored authorization URL commit atomically. Only the `201`
	 * outcome is recordable: `200 already_registered` mutates nothing and
	 * leaves the key unconsumed. `proof` was generated entirely in the
	 * Worker (state/nonce/proof-key secret randoms, S256 challenge, URL)
	 * before this synchronous section ran.
	 */
	apiCreateRegistrationIntent(
		principal: ServicePrincipal,
		idempotency: IdempotencyParams,
		input: ExternalIdentity,
		proof: RegistrationProofMaterial,
	): RouteResponse {
		if (principal !== DISCORD_ADAPTER_PRINCIPAL) {
			return errorDescriptor(
				403,
				"forbidden",
				`route requires the ${DISCORD_ADAPTER_PRINCIPAL} principal`,
			);
		}
		return this.uow.transact((ctx) => {
			const outcome = executeIdempotent(
				ctx,
				{
					servicePrincipal: principal,
					idempotencyKey: idempotency.key,
					fingerprintVersion: idempotency.fingerprintVersion,
					requestFingerprint: idempotency.requestFingerprint,
				},
				(): IdempotentExecution<RouteResponse> => {
					const result = createRegistrationIntentOperation(ctx, {
						expectedIssuer: input.issuer,
						expectedSubject: input.subject,
						state: proof.state,
						nonce: proof.nonce,
						proofKeySecret: proof.proofKeySecret,
					});
					if (result.type === "alreadyRegistered") {
						return {
							record: false,
							result: {
								status: 200,
								body: { status: "already_registered" },
							},
						};
					}
					const descriptor: RouteResponse = {
						status: 201,
						body: {
							status: "created",
							authorization_url: proof.authorizationUrl,
							expires_at: result.expiresAt,
						},
					};
					return {
						record: true,
						result: descriptor,
						storedResult: JSON.stringify(descriptor),
					};
				},
			);
			switch (outcome.type) {
				case "replayed":
					return parseStoredResult(outcome.storedResult);
				case "conflict":
					return errorDescriptor(
						409,
						"idempotency_key_reuse",
						"the idempotency key was already used with a different request",
					);
				case "executed":
					return outcome.result;
			}
		});
	}

	/**
	 * The public callback's synchronous intent read (issue #4 PR-4): the
	 * proof material the Worker needs to continue the OIDC exchange, or
	 * `unavailable` for a missing, non-active, or expired intent. Expiry
	 * is evaluated against the section's frozen clock, exactly as the
	 * completion use case evaluates it.
	 */
	getOidcRegistrationIntent(state: string): OidcRegistrationIntentRead {
		return this.uow.transact((ctx) => {
			const intent = ctx.registrationIntents.findByState(state);
			if (
				intent === undefined ||
				intent.status !== "active" ||
				ctx.nowMs >= intent.expiresAt
			) {
				return { type: "unavailable" };
			}
			return {
				type: "active",
				expectedIssuer: intent.expectedIssuer,
				expectedSubject: intent.expectedSubject,
				nonce: intent.nonce,
				proofKeySecret: intent.proofKeySecret,
			};
		});
	}

	/**
	 * The public callback's completion RPC (issue #4 PR-4): re-checks the
	 * intent's validity and the exact verified identity inside one
	 * serialized section, then resolves-or-creates User + wallet +
	 * IdentityBinding and consumes the intent — the atomic result of the
	 * registration specification. The outcome crosses the RPC boundary
	 * verbatim; the callback maps `unavailable` reasons onto pages.
	 */
	completeOidcRegistration(
		state: string,
		verified: VerifiedIdentity,
	): CompleteRegistrationOutcome {
		return this.uow.transact((ctx) =>
			completeRegistrationOperation(ctx, {
				state,
				verifiedIssuer: verified.issuer,
				verifiedSubject: verified.subject,
			}),
		);
	}

	// ---- Test-support methods (unreachable from fetch) ----------------

	/**
	 * Registers a user and its single zero-balance wallet for the
	 * contract suite: `users` then `wallets` inside one serialized
	 * transaction (the FK order workerd enforces). The suite-supplied id
	 * is stored verbatim — caller-supplied test input, not a relaxation
	 * of production `crypto.randomUUID()` id generation — while the
	 * seeded wallet id is a fresh UUID. A duplicate id returns
	 * `{ ok: false }` from inside the same serialized section rather
	 * than relying on a constraint exception crossing the RPC boundary.
	 */
	createUser(rawUserId: string): CreateUserResult {
		return this.ctx.storage.transactionSync(() => {
			const existing = this.ctx.storage.sql
				.exec("SELECT id FROM users WHERE id = ?", rawUserId)
				.toArray();
			if (existing.length > 0) {
				return { ok: false, error: `user already exists: ${rawUserId}` };
			}
			const t = this.clock.nowMs();
			this.ctx.storage.sql.exec(
				"INSERT INTO users (id, created_at) VALUES (?, ?)",
				rawUserId,
				t,
			);
			this.ctx.storage.sql.exec(
				"INSERT INTO wallets (id, kind, owner_user_id, balance, created_at, updated_at) VALUES (?, 'user', ?, 0, ?, ?)",
				crypto.randomUUID(),
				rawUserId,
				t,
				t,
			);
			return { ok: true };
		});
	}

	/**
	 * Test-support registration of a bound identity (issue #4 PR-3):
	 * atomically inserts the User, its single zero-balance user wallet,
	 * and the IdentityBinding for the exact `(issuer, subject)` pair —
	 * the state production registration commits in PR-4, seeded verbatim
	 * here so route-facing resolution can be exercised. Unreachable from
	 * `fetch`. A duplicate user id or duplicate `(issuer, subject)` pair
	 * is an expected conflict returned as a value, matching `createUser`.
	 */
	createBoundUser(
		rawUserId: string,
		issuer: string,
		subject: string,
	): CreateUserResult {
		return this.ctx.storage.transactionSync(() => {
			const existing = this.ctx.storage.sql
				.exec("SELECT id FROM users WHERE id = ?", rawUserId)
				.toArray();
			if (existing.length > 0) {
				return { ok: false, error: `user already exists: ${rawUserId}` };
			}
			const bound = this.ctx.storage.sql
				.exec(
					"SELECT issuer FROM identity_bindings WHERE issuer = ? AND subject = ?",
					issuer,
					subject,
				)
				.toArray();
			if (bound.length > 0) {
				return {
					ok: false,
					error: `identity already bound: ${issuer}:${subject}`,
				};
			}
			const t = this.clock.nowMs();
			this.ctx.storage.sql.exec(
				"INSERT INTO users (id, created_at) VALUES (?, ?)",
				rawUserId,
				t,
			);
			this.ctx.storage.sql.exec(
				"INSERT INTO wallets (id, kind, owner_user_id, balance, created_at, updated_at) VALUES (?, 'user', ?, 0, ?, ?)",
				crypto.randomUUID(),
				rawUserId,
				t,
				t,
			);
			this.ctx.storage.sql.exec(
				"INSERT INTO identity_bindings (issuer, subject, user_id, created_at) VALUES (?, ?, ?, ?)",
				issuer,
				subject,
				rawUserId,
				t,
			);
			return { ok: true };
		});
	}

	/**
	 * The non-facade application operation the Phase 1 contract adapter
	 * drives: resolves `WalletSelector`s and runs the normal
	 * evaluate/persist choreography inside one serialized transaction.
	 * `actor` is supplied explicitly by the harness's deterministic
	 * mapping and is persisted verbatim as audit context.
	 */
	applyEconomicCommand(
		actor: Actor,
		command: EconomicSelectorCommand,
	): UseCaseResult<OperationAccepted> {
		return this.uow.transact((ctx) =>
			applyEconomicCommandOperation(ctx, actor, command),
		);
	}

	listOperations(): readonly OperationRow[] {
		return this.ctx.storage.sql
			.exec(
				"SELECT id, kind, metadata, actor_kind, actor_id, created_at FROM economic_operations ORDER BY rowid",
			)
			.toArray() as unknown as OperationRow[];
	}

	listLedger(): readonly LedgerRow[] {
		return this.ctx.storage.sql
			.exec(
				"SELECT id, operation_id, from_wallet_id, to_wallet_id, amount, created_at FROM ledger_transactions ORDER BY rowid",
			)
			.toArray() as unknown as LedgerRow[];
	}

	issuedAmount(): number {
		return Number(
			this.ctx.storage.sql
				.exec(
					"SELECT COALESCE(SUM(l.amount), 0) AS total " +
						"FROM ledger_transactions l " +
						"JOIN economic_operations o ON o.id = l.operation_id " +
						"WHERE o.kind = 'TOKEN_ISSUANCE'",
				)
				.one()["total"],
		);
	}

	/**
	 * The supply fact through the production wallet-repository aggregate
	 * inside a transaction — the same read path the evaluator's facts
	 * use, not a separate raw query.
	 */
	totalSupply(): number {
		return this.uow.transact((ctx) => ctx.wallets.totalSupply());
	}
}
