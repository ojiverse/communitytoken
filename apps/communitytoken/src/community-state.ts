import { DurableObject } from "cloudflare:workers";
import {
	ADMIN_API_CALLER,
	type Clock,
	type CompleteRegistrationOutcome,
	completeRegistration,
	createRegistrationIntent,
	type ExternalIdentity,
	ensureAdministrativeIssuer,
	executeIdempotent,
	getBalance,
	getTransactionHistory,
	type HistoryEntry,
	type IdempotentExecution,
	issueToIdentity,
	type Page,
	type TransactionContext,
	transferBetweenIdentities,
	type UnitOfWork,
	type UseCaseError,
} from "@communitytoken/application";
import { DISCORD_ADAPTER_CALLER, type TechnicalCaller } from "./auth";
import { SCHEMA } from "./schema";
import { createStorageUnitOfWork } from "./unit-of-work";

/** A JSON-serializable value — the shape every route response body takes. */
export type JsonValue =
	| string
	| number
	| boolean
	| null
	| readonly JsonValue[]
	| { readonly [key: string]: JsonValue };

/**
 * A serializable route outcome: the HTTP status plus JSON body the Worker
 * forwards verbatim. Expected failures are descriptors, never throws;
 * unexpected storage/contract/runtime failures throw and the Worker maps the
 * rejection to `500 internal_error`.
 */
export type RouteResponse = {
	readonly status: number;
	readonly body: JsonValue;
};

export type { ExternalIdentity };

/**
 * The caller-computed idempotency inputs of a protected route: the verbatim
 * `Idempotency-Key` header value plus the fingerprint the Worker computed
 * (SHA-256 is async, so it cannot run inside the synchronous section).
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

/**
 * Wire input of `POST /api/v1/admin/issuances`, wire-validated by the
 * Worker: the target ExternalIdentity and the amount — nothing else.
 */
export type AdminIssueInput = {
	readonly target: ExternalIdentity;
	readonly amount: number;
};

/**
 * The unguessable registration material the Worker generates before the
 * serialized creation section: the correlation `state`, the authentication
 * `nonce`, the provider-independent `proofKeySecret` (persisted in the
 * `pkce_verifier` column), and the authorization URL whose verbatim bytes
 * the replay record stores. The OIDC client secret never crosses a DO
 * boundary.
 */
export type RegistrationProofMaterial = {
	readonly state: string;
	readonly nonce: string;
	readonly proofKeySecret: string;
	readonly authorizationUrl: string;
};

/**
 * What the public callback's synchronous intent read returns: the proof
 * material needed to continue the OIDC exchange, or `unavailable` for a
 * missing, non-active, or expired intent.
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
export type VerifiedIdentity = ExternalIdentity;

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
 * forbidden caller is `403 forbidden`; an unresolved identity or missing
 * default Account is `404` with the lowercased code; a primitive rejection
 * is `422` with the lowercased code; an input-contract violation is `400`
 * with the lowercased code.
 */
function useCaseErrorDescriptor(error: UseCaseError): RouteResponse {
	switch (error.type) {
		case "forbidden":
			return errorDescriptor(403, "forbidden", error.detail);
		case "unresolved":
			return errorDescriptor(404, error.code.toLowerCase(), error.detail);
		case "rejected":
			return errorDescriptor(422, error.code.toLowerCase(), error.detail);
		case "invalid-input":
			return errorDescriptor(400, error.code.toLowerCase(), error.detail);
	}
}

/**
 * The fixed snake_case history entry of the HTTP response contract. It
 * carries primitive Transaction facts and the external counterparty
 * projection — never an internal Principal or Account identifier.
 */
function serializeHistoryEntry(entry: HistoryEntry): JsonValue {
	return {
		transaction_id: entry.transactionId,
		kind: entry.kind,
		amount: entry.amount,
		committed_at: entry.committedAt,
		direction: entry.direction,
		counterparty:
			entry.counterparty === null
				? null
				: {
						issuer: entry.counterparty.issuer,
						subject: entry.counterparty.subject,
					},
	};
}

/** The `{transactions, next_cursor}` body of the history route. */
function historyDescriptor(page: Page<HistoryEntry>): RouteResponse {
	return {
		status: 200,
		body: {
			transactions: page.entries.map(serializeHistoryEntry),
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

/** Marks a successful descriptor recordable: it is replayed verbatim. */
function recorded(
	descriptor: RouteResponse,
): IdempotentExecution<RouteResponse> {
	return {
		record: true,
		result: descriptor,
		storedResult: JSON.stringify(descriptor),
	};
}

/**
 * Runs `execute` under the idempotency choreography inside the caller's
 * open section and maps the outcome onto a descriptor: a matching record
 * replays verbatim, a key reused with different content is `409`, and a
 * fresh execution returns its own descriptor — with the replay record
 * committed in the same section only when `execute` marked it recordable.
 */
function idempotentDescriptor(
	ctx: TransactionContext,
	caller: TechnicalCaller,
	idempotency: IdempotencyParams,
	execute: () => IdempotentExecution<RouteResponse>,
): RouteResponse {
	const outcome = executeIdempotent(
		ctx,
		{
			technicalCaller: caller,
			idempotencyKey: idempotency.key,
			fingerprintVersion: idempotency.fingerprintVersion,
			requestFingerprint: idempotency.requestFingerprint,
		},
		execute,
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
}

/** The misroute backstop: the route group's required technical caller. */
function wrongCaller(
	caller: TechnicalCaller,
	required: TechnicalCaller,
): RouteResponse | null {
	return caller === required
		? null
		: errorDescriptor(
				403,
				"forbidden",
				`route requires the ${required} technical caller`,
			);
}

/**
 * The production CommunityState Durable Object: the single serialization
 * authority for one community's durable ledger and application state. The
 * deployment dereferences exactly one instance via
 * `idFromName("community")`.
 *
 * All mutable state lives in `ctx.storage.sql`; the object keeps no cached
 * state in instance fields, so eviction/restart cannot lose committed data.
 * Initialization runs under `blockConcurrencyWhile` before any RPC:
 * schema creation, then the narrow application-owned initialization of the
 * administrative issuer Principal.
 *
 * The RPC surface is exactly the route-facing methods — the trusted core
 * API (`internalBalance`, `internalHistory`, `internalTransfer`,
 * `adminIssue`), idempotent intent creation (`apiCreateRegistrationIntent`),
 * and the public-callback pair (`getOidcRegistrationIntent`,
 * `completeOidcRegistration`). Caller-bearing methods receive the Worker's
 * asserted technical caller (never bearer bytes) and re-check it against
 * their route group as a misroute backstop. Each method owns its complete
 * `uow.transact` section. There is no test-support or generic ledger
 * method: `adminIssue` is the only method that can construct an ISSUE.
 */
export class CommunityState extends DurableObject {
	private readonly uow: UnitOfWork;

	/**
	 * The clock authority behind the UnitOfWork's per-section sample. The
	 * production value is `Date.now()`; the field is the injection seam
	 * deterministic tests replace (request-supplied timestamps are never
	 * accepted).
	 */
	clock: Clock = { nowMs: () => Date.now() };

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.uow = createStorageUnitOfWork(ctx.storage, {
			nowMs: () => this.clock.nowMs(),
		});
		ctx.blockConcurrencyWhile(async () => {
			ctx.storage.sql.exec(SCHEMA);
			this.uow.transact((tx) => ensureAdministrativeIssuer(tx));
		});
	}

	/**
	 * `POST /api/v1/balance`: the caller identity's own default-Account
	 * balance under self-only visibility.
	 */
	internalBalance(
		caller: TechnicalCaller,
		input: ExternalIdentity,
	): RouteResponse {
		const denied = wrongCaller(caller, DISCORD_ADAPTER_CALLER);
		if (denied) return denied;
		return this.uow.transact((ctx) => {
			const result = getBalance(ctx, {
				issuer: input.issuer,
				subject: input.subject,
			});
			return result.ok
				? { status: 200, body: { balance: result.value.balance } }
				: useCaseErrorDescriptor(result.error);
		});
	}

	/**
	 * `POST /api/v1/history`: newest-first cursor-paginated self-history of
	 * the caller identity's default Account.
	 */
	internalHistory(
		caller: TechnicalCaller,
		input: InternalHistoryInput,
	): RouteResponse {
		const denied = wrongCaller(caller, DISCORD_ADAPTER_CALLER);
		if (denied) return denied;
		return this.uow.transact((ctx) => {
			const result = getTransactionHistory(
				ctx,
				{ issuer: input.issuer, subject: input.subject },
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
	 * `POST /api/v1/transfers`: the idempotency-protected user TRANSFER. A
	 * successful TRANSFER and its replay record (including
	 * `transaction_id`) commit atomically; expected non-mutating failures
	 * record nothing and leave the key retryable.
	 */
	internalTransfer(
		caller: TechnicalCaller,
		idempotency: IdempotencyParams,
		input: InternalTransferInput,
	): RouteResponse {
		const denied = wrongCaller(caller, DISCORD_ADAPTER_CALLER);
		if (denied) return denied;
		return this.uow.transact((ctx) =>
			idempotentDescriptor(ctx, caller, idempotency, () => {
				const result = transferBetweenIdentities(ctx, {
					from: input.from,
					to: input.to,
					amount: input.amount,
				});
				if (!result.ok) {
					return {
						record: false,
						result: useCaseErrorDescriptor(result.error),
					};
				}
				return recorded({
					status: 200,
					body: {
						transaction_id: result.value.transactionId,
						from_balance: result.value.fromBalance,
					},
				});
			}),
		);
	}

	/**
	 * `POST /api/v1/admin/issuances`: the idempotency-protected
	 * administrative ISSUE — the only construction path of an ISSUE. The
	 * admin technical caller maps to the stable administrative issuer
	 * Principal; the target identity resolves to its default Account. The
	 * ISSUE and its replay record (including `transaction_id`) commit
	 * atomically.
	 */
	adminIssue(
		caller: TechnicalCaller,
		idempotency: IdempotencyParams,
		input: AdminIssueInput,
	): RouteResponse {
		// Narrows `caller` to the administrative caller the use case requires.
		if (caller !== ADMIN_API_CALLER) {
			return errorDescriptor(
				403,
				"forbidden",
				`route requires the ${ADMIN_API_CALLER} technical caller`,
			);
		}
		return this.uow.transact((ctx) =>
			idempotentDescriptor(ctx, caller, idempotency, () => {
				const result = issueToIdentity(ctx, caller, {
					target: input.target,
					amount: input.amount,
				});
				if (!result.ok) {
					return {
						record: false,
						result: useCaseErrorDescriptor(result.error),
					};
				}
				return recorded({
					status: 200,
					body: { transaction_id: result.value.transactionId },
				});
			}),
		);
	}

	/**
	 * `POST /api/v1/registration-intents`: the idempotency-protected intent
	 * creation. Only the `201` outcome is recordable: `200
	 * already_registered` mutates nothing and leaves the key unconsumed.
	 * `proof` was generated entirely in the Worker before this synchronous
	 * section ran.
	 */
	apiCreateRegistrationIntent(
		caller: TechnicalCaller,
		idempotency: IdempotencyParams,
		input: ExternalIdentity,
		proof: RegistrationProofMaterial,
	): RouteResponse {
		const denied = wrongCaller(caller, DISCORD_ADAPTER_CALLER);
		if (denied) return denied;
		return this.uow.transact((ctx) =>
			idempotentDescriptor(ctx, caller, idempotency, () => {
				const result = createRegistrationIntent(ctx, {
					expectedIssuer: input.issuer,
					expectedSubject: input.subject,
					state: proof.state,
					nonce: proof.nonce,
					proofKeySecret: proof.proofKeySecret,
				});
				if (result.type === "alreadyRegistered") {
					return {
						record: false,
						result: { status: 200, body: { status: "already_registered" } },
					};
				}
				return recorded({
					status: 201,
					body: {
						status: "created",
						authorization_url: proof.authorizationUrl,
						expires_at: result.expiresAt,
					},
				});
			}),
		);
	}

	/**
	 * The public callback's synchronous intent read: the proof material the
	 * Worker needs to continue the OIDC exchange, or `unavailable` for a
	 * missing, non-active, or expired intent. Expiry is evaluated against
	 * the section's frozen clock, exactly as completion evaluates it.
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
	 * The public callback's completion RPC: re-checks the intent's validity
	 * and the exact verified identity inside one serialized section, then
	 * resolves-or-creates Principal + zero-balance Account + default
	 * designation + IdentityBinding and consumes the intent.
	 */
	completeOidcRegistration(
		state: string,
		verified: VerifiedIdentity,
	): CompleteRegistrationOutcome {
		return this.uow.transact((ctx) =>
			completeRegistration(ctx, {
				state,
				verifiedIssuer: verified.issuer,
				verifiedSubject: verified.subject,
			}),
		);
	}
}
