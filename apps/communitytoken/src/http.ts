/**
 * The Worker-side HTTP pipeline of the trusted core API plus the public
 * OIDC callback (issue #4 PR-3/PR-4): exact method+pathname routing, then
 * per-route access — `ServiceRoute` runs Bearer authentication and
 * caller authorization before the handler, `PublicRoute` runs the
 * handler with no caller at all.
 *
 * Request-level ordering on service routes is fixed: route match (404) →
 * authenticate (401) → authorize the route's required caller (403) →
 * media type (415) → JSON object and exact wire shape (400) →
 * Idempotency-Key where required (400) → fingerprint (400 on
 * canonicalization failure) → DO call. Route-facing DO methods return
 * `{status, body}` descriptors forwarded verbatim. Each route owns its
 * unexpected-failure renderer: JSON application routes normalize any
 * unexpected exception to `500 internal_error`, while the public OIDC
 * callback renders its generic HTML 500 page — the callback never
 * produces JSON.
 *
 * Routing is exact: no trailing-slash normalization, no case
 * normalization, and a wrong method on a known path is `404 not_found`
 * (the route set is method+path pairs). Query parameters on POST routes
 * are ignored for routing, validation, and fingerprinting. No CORS
 * headers are emitted.
 */

import {
	ADMIN_API_CALLER,
	type CompleteRegistrationOutcome,
} from "@communitytoken/application";
import {
	authenticate,
	DISCORD_ADAPTER_CALLER,
	type TechnicalCaller,
} from "./auth";
import type {
	AdminIssueInput,
	ExternalIdentity,
	IdempotencyParams,
	InternalHistoryInput,
	InternalTransferInput,
	OidcRegistrationIntentRead,
	RegistrationProofMaterial,
	RouteResponse,
	VerifiedIdentity,
} from "./community-state";
import {
	CanonicalizationError,
	FINGERPRINT_VERSION,
	requestFingerprintV1,
} from "./fingerprint";
import {
	buildAuthorizationUrl,
	computeProofKeyChallenge,
	failurePage,
	generateRegistrationSecrets,
	handleOidcCallback,
	readOidcConfig,
} from "./registration";

/**
 * The route-facing RPC surface the Worker invokes (issue #4 PR-3). The
 * generic `DurableObjectStub<CommunityState>` cannot be used here: its
 * stub-typing transform recurses through the recursive `JsonValue`
 * response type past the type checker's instantiation depth. This
 * interface declares the contract; `CommunityState` implements the
 * corresponding synchronous methods and RPC promises wrap their returns.
 */
export interface CommunityStateApi {
	/**
	 * `POST /api/v1/balance` for the asserted caller.
	 * @returns the route outcome descriptor; never rejects for expected
	 *   failures.
	 * @throws {Error} on unexpected storage/contract/runtime failure.
	 */
	internalBalance(
		caller: TechnicalCaller,
		input: ExternalIdentity,
	): Promise<RouteResponse>;

	/**
	 * `POST /api/v1/history` for the asserted caller.
	 * @returns the route outcome descriptor; never rejects for expected
	 *   failures.
	 * @throws {Error} on unexpected storage/contract/runtime failure.
	 */
	internalHistory(
		caller: TechnicalCaller,
		input: InternalHistoryInput,
	): Promise<RouteResponse>;

	/**
	 * `POST /api/v1/transfers` for the asserted caller.
	 * @returns the route outcome descriptor, replayed verbatim when the
	 *   idempotency record matches; never rejects for expected failures.
	 * @throws {Error} on unexpected storage/contract/runtime failure.
	 */
	internalTransfer(
		caller: TechnicalCaller,
		idempotency: IdempotencyParams,
		input: InternalTransferInput,
	): Promise<RouteResponse>;

	/**
	 * `POST /api/v1/admin/issuances` for the asserted caller.
	 * @returns the route outcome descriptor, replayed verbatim when the
	 *   idempotency record matches; never rejects for expected failures.
	 * @throws {Error} on unexpected storage/contract/runtime failure.
	 */
	adminIssue(
		caller: TechnicalCaller,
		idempotency: IdempotencyParams,
		input: AdminIssueInput,
	): Promise<RouteResponse>;

	/**
	 * `POST /api/v1/registration-intents` for the asserted caller
	 * (issue #4 PR-4). `proof` carries the Worker-generated
	 * state/nonce/proof-key secret and the authorization URL the `201`
	 * replay record stores verbatim; the OIDC client secret never crosses
	 * this boundary.
	 * @returns the route outcome descriptor, replayed verbatim when the
	 *   idempotency record matches; never rejects for expected failures.
	 * @throws {Error} on unexpected storage/contract/runtime failure.
	 */
	apiCreateRegistrationIntent(
		caller: TechnicalCaller,
		idempotency: IdempotencyParams,
		input: ExternalIdentity,
		proof: RegistrationProofMaterial,
	): Promise<RouteResponse>;

	/**
	 * The public callback's synchronous intent read (issue #4 PR-4).
	 * @returns the active intent's proof material, or `unavailable` for a
	 *   missing, non-active, or expired intent; never rejects for expected
	 *   states.
	 * @throws {Error} on unexpected storage/contract/runtime failure.
	 */
	getOidcRegistrationIntent(state: string): Promise<OidcRegistrationIntentRead>;

	/**
	 * The public callback's completion RPC (issue #4 PR-4).
	 * @returns the `completeRegistration` outcome verbatim; never rejects
	 *   for expected failures.
	 * @throws {Error} on unexpected storage/contract/runtime failure.
	 */
	completeOidcRegistration(
		state: string,
		verified: VerifiedIdentity,
	): Promise<CompleteRegistrationOutcome>;
}

/**
 * The fixed decimal grammar for history pagination values: `0` or a
 * decimal integer with no leading zero. Rejects signs, whitespace,
 * exponents, hex/octal forms, and empty strings.
 */
const DECIMAL_INTEGER = /^(0|[1-9][0-9]*)$/;

/**
 * The `Idempotency-Key` constraint of the idempotency specification:
 * required on every protected mutation route (transfers, admin
 * issuances, registration intents), length `1..255`, the header value
 * used verbatim — never trimmed or normalized.
 */
const IDEMPOTENCY_KEY_MAX_LENGTH = 255;

/** The single community instance stub (issue #4 fixed topology). */
function communityStub(env: Env): CommunityStateApi {
	return env.COMMUNITY_STATE.get(
		env.COMMUNITY_STATE.idFromName("community"),
	) as unknown as CommunityStateApi;
}

/** The handler context shared by every route access kind. */
type BaseRouteContext = {
	readonly request: Request;
	readonly url: URL;
	readonly env: Env;
	/**
	 * Acquires the `CommunityState` stub. Lazily evaluated: a handler calls
	 * it only after every Worker-side validation step (media type, JSON
	 * parse, exact shape, Idempotency-Key, fingerprint, query grammar) has
	 * succeeded — the fixed pipeline order puts DO acquisition immediately
	 * before the RPC, so a request that fails validation never touches the
	 * binding.
	 */
	readonly getStub: () => CommunityStateApi;
};

/** The context of a public protocol route: deliberately no caller. */
type PublicRouteContext = BaseRouteContext;

/**
 * The context of a service route after Bearer authentication and
 * caller authorization have succeeded: `caller` is the asserted
 * technical caller the handler forwards to the DO.
 */
type ServiceRouteContext = BaseRouteContext & {
	readonly caller: TechnicalCaller;
};

/**
 * A public protocol route (issue #4 PR-4): no authentication runs and the
 * handler receives no caller. Its `unexpectedError` renderer produces
 * the route's fixed failure surface — the OIDC callback's generic HTML
 * page — so an unexpected exception can never leak JSON internals onto a
 * protocol endpoint.
 */
type PublicRoute = {
	readonly access: "public";
	readonly unexpectedError: () => Response;
	readonly handle: (context: PublicRouteContext) => Promise<Response>;
};

/**
 * An authenticated service route: the dispatcher asserts a Bearer
 * credential and checks it equals `requiredCaller` (least privilege —
 * the admin namespace is lexically nested below `/api/v1` but is a
 * distinct authorization group). `unexpectedError` renders the JSON
 * `500 internal_error` contract.
 */
type ServiceRoute = {
	readonly access: "service";
	readonly requiredCaller: TechnicalCaller;
	readonly unexpectedError: () => Response;
	readonly handle: (context: ServiceRouteContext) => Promise<Response>;
};

type Route = PublicRoute | ServiceRoute;

/**
 * The result of a validation step: the typed value, or the exact error
 * response to return. Validators are total — a failure always carries its
 * response.
 */
type Validation<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly response: Response };

function valid<T>(value: T): Validation<T> {
	return { ok: true, value };
}

function invalid<T>(response: Response): Validation<T> {
	return { ok: false, response };
}

/** The fixed error body `{error[, error_description]}` as a Response. */
function errorResponse(
	status: number,
	code: string,
	description?: string,
): Response {
	return Response.json(
		description === undefined
			? { error: code }
			: { error: code, error_description: description },
		{ status },
	);
}

function invalidRequest<T>(detail: string): Validation<T> {
	return invalid(errorResponse(400, "invalid_request", detail));
}

/** A plain JSON object — the only acceptable request-body top level. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

/**
 * The first property name not in `allowed`, or null. Unknown fields are
 * rejected rather than ignored: fingerprint v1 hashes the whole parsed
 * body, so a silently ignored field would change the fingerprint and
 * corrupt replay detection.
 */
function unknownField(
	record: Record<string, unknown>,
	allowed: readonly string[],
): string | null {
	for (const key of Object.keys(record)) {
		if (!allowed.includes(key)) return key;
	}
	return null;
}

/** A decimal cursor per the fixed grammar and the safe-integer range. */
function isDecimalCursor(value: string): boolean {
	return DECIMAL_INTEGER.test(value) && Number.isSafeInteger(Number(value));
}

/** The media type of a Content-Type header, lowercased, without parameters. */
function mediaTypeOf(contentType: string): string {
	const semicolon = contentType.indexOf(";");
	const type = semicolon === -1 ? contentType : contentType.slice(0, semicolon);
	return type.trim().toLowerCase();
}

/**
 * Reads the request body as a JSON object: `application/json` media type
 * (415 otherwise), well-formed JSON (400 otherwise), object top level
 * (400 otherwise). The parsed value is what the fingerprint hashes, so
 * nothing may be re-serialized downstream.
 */
async function readJsonObject(
	request: Request,
): Promise<Validation<Record<string, unknown>>> {
	const contentType = request.headers.get("Content-Type");
	if (contentType === null || mediaTypeOf(contentType) !== "application/json") {
		return invalid(
			errorResponse(
				415,
				"unsupported_media_type",
				"expected Content-Type: application/json",
			),
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(await request.text());
	} catch {
		return invalidRequest("request body is not valid JSON");
	}
	if (!isRecord(parsed)) {
		return invalidRequest("request body must be a JSON object");
	}
	return valid(parsed);
}

/**
 * Validates an `{issuer, subject}` object — the standalone balance body or
 * a `from`/`to` part of the transfer body. `label` names the field in
 * error details.
 */
function validateIdentity(
	value: unknown,
	label: string,
): Validation<ExternalIdentity> {
	if (!isRecord(value)) {
		return invalidRequest(`${label} must be a JSON object`);
	}
	const extra = unknownField(value, ["issuer", "subject"]);
	if (extra !== null) {
		return invalidRequest(`unknown field: ${label}.${extra}`);
	}
	if (
		!isNonEmptyString(value["issuer"]) ||
		!isNonEmptyString(value["subject"])
	) {
		return invalidRequest(
			`${label} requires non-empty string issuer and subject`,
		);
	}
	return valid({ issuer: value["issuer"], subject: value["subject"] });
}

function validateBalanceBody(
	body: Record<string, unknown>,
): Validation<ExternalIdentity> {
	return validateIdentity(body, "body");
}

function validateHistoryBody(
	body: Record<string, unknown>,
): Validation<InternalHistoryInput> {
	const extra = unknownField(body, ["issuer", "subject", "cursor", "limit"]);
	if (extra !== null) {
		return invalidRequest(`unknown field: ${extra}`);
	}
	if (!isNonEmptyString(body["issuer"]) || !isNonEmptyString(body["subject"])) {
		return invalidRequest("body requires non-empty string issuer and subject");
	}
	const input: {
		issuer: string;
		subject: string;
		cursor?: string;
		limit?: number;
	} = { issuer: body["issuer"], subject: body["subject"] };
	if (body["cursor"] !== undefined) {
		const cursor = body["cursor"];
		if (typeof cursor !== "string" || !isDecimalCursor(cursor)) {
			return invalid(
				errorResponse(
					400,
					"invalid_cursor",
					"cursor must be a decimal cursor string",
				),
			);
		}
		input.cursor = cursor;
	}
	if (body["limit"] !== undefined) {
		const limit = body["limit"];
		if (
			typeof limit !== "number" ||
			!Number.isInteger(limit) ||
			limit < 1 ||
			limit > 100
		) {
			return invalid(
				errorResponse(
					400,
					"invalid_limit",
					"limit must be an integer in 1..100",
				),
			);
		}
		input.limit = limit;
	}
	return valid(input);
}

function validateTransfersBody(
	body: Record<string, unknown>,
): Validation<InternalTransferInput> {
	const extra = unknownField(body, ["from", "to", "amount"]);
	if (extra !== null) {
		return invalidRequest(`unknown field: ${extra}`);
	}
	const from = validateIdentity(body["from"], "from");
	if (!from.ok) return from;
	const to = validateIdentity(body["to"], "to");
	if (!to.ok) return to;
	const amount = body["amount"];
	if (typeof amount !== "number" || !Number.isFinite(amount)) {
		return invalidRequest("amount must be a finite JSON number");
	}
	return valid({ from: from.value, to: to.value, amount });
}

function validateIssueBody(
	body: Record<string, unknown>,
): Validation<AdminIssueInput> {
	const extra = unknownField(body, ["target", "amount"]);
	if (extra !== null) {
		return invalidRequest(`unknown field: ${extra}`);
	}
	const target = validateIdentity(body["target"], "target");
	if (!target.ok) return target;
	const amount = body["amount"];
	if (typeof amount !== "number" || !Number.isFinite(amount)) {
		return invalidRequest("amount must be a finite JSON number");
	}
	return valid({ target: target.value, amount });
}

/**
 * The protected-mutation steps after wire-shape validation: the
 * `Idempotency-Key` header (400 `idempotency_key_required` when absent or
 * outside `1..255`), then fingerprint v1 over the parsed body (400
 * `invalid_request` on canonicalization failure). Both run before the DO
 * call because SHA-256 is asynchronous.
 */
async function readIdempotency(
	request: Request,
	url: URL,
	body: Record<string, unknown>,
): Promise<Validation<IdempotencyParams>> {
	const key = request.headers.get("Idempotency-Key");
	if (
		key === null ||
		key.length === 0 ||
		key.length > IDEMPOTENCY_KEY_MAX_LENGTH
	) {
		return invalid(
			errorResponse(
				400,
				"idempotency_key_required",
				"Idempotency-Key header must be present and 1..255 characters",
			),
		);
	}
	try {
		const requestFingerprint = await requestFingerprintV1(
			request.method,
			url.pathname,
			body,
		);
		return valid({
			key,
			fingerprintVersion: FINGERPRINT_VERSION,
			requestFingerprint,
		});
	} catch (error) {
		if (error instanceof CanonicalizationError) {
			return invalidRequest("request body cannot be canonically serialized");
		}
		throw error;
	}
}

/**
 * Runs the route-facing DO call and forwards its `{status, body}`
 * descriptor verbatim as the HTTP response. An unexpected rejection —
 * storage, contract, or runtime failure inside the object — becomes
 * `500 internal_error` with no detail leak.
 */
async function invoke(call: () => Promise<RouteResponse>): Promise<Response> {
	try {
		const { status, body } = await call();
		return Response.json(body, { status });
	} catch {
		return errorResponse(500, "internal_error", "unexpected internal error");
	}
}

/** The JSON `500 internal_error` renderer every service route shares. */
function jsonInternalError(): Response {
	return errorResponse(500, "internal_error", "unexpected internal error");
}

const internalBalanceRoute: ServiceRoute = {
	access: "service",
	requiredCaller: DISCORD_ADAPTER_CALLER,
	unexpectedError: jsonInternalError,
	async handle({ request, caller, getStub }) {
		const body = await readJsonObject(request);
		if (!body.ok) return body.response;
		const input = validateBalanceBody(body.value);
		if (!input.ok) return input.response;
		const stub = getStub();
		return invoke(() => stub.internalBalance(caller, input.value));
	},
};

const internalHistoryRoute: ServiceRoute = {
	access: "service",
	requiredCaller: DISCORD_ADAPTER_CALLER,
	unexpectedError: jsonInternalError,
	async handle({ request, caller, getStub }) {
		const body = await readJsonObject(request);
		if (!body.ok) return body.response;
		const input = validateHistoryBody(body.value);
		if (!input.ok) return input.response;
		const stub = getStub();
		return invoke(() => stub.internalHistory(caller, input.value));
	},
};

const internalTransfersRoute: ServiceRoute = {
	access: "service",
	requiredCaller: DISCORD_ADAPTER_CALLER,
	unexpectedError: jsonInternalError,
	async handle({ request, url, caller, getStub }) {
		const body = await readJsonObject(request);
		if (!body.ok) return body.response;
		const input = validateTransfersBody(body.value);
		if (!input.ok) return input.response;
		const idempotency = await readIdempotency(request, url, body.value);
		if (!idempotency.ok) return idempotency.response;
		const stub = getStub();
		return invoke(() =>
			stub.internalTransfer(caller, idempotency.value, input.value),
		);
	},
};

/**
 * `POST /api/v1/admin/issuances`: the administrative ISSUE route. Same
 * fixed order as the transfer route — wire shape, then Idempotency-Key,
 * then fingerprint — so a duplicate delivery replays the stored
 * `transaction_id` instead of issuing twice.
 */
const adminIssueRoute: ServiceRoute = {
	access: "service",
	requiredCaller: ADMIN_API_CALLER,
	unexpectedError: jsonInternalError,
	async handle({ request, url, caller, getStub }) {
		const body = await readJsonObject(request);
		if (!body.ok) return body.response;
		const input = validateIssueBody(body.value);
		if (!input.ok) return input.response;
		const idempotency = await readIdempotency(request, url, body.value);
		if (!idempotency.ok) return idempotency.response;
		const stub = getStub();
		return invoke(() =>
			stub.adminIssue(caller, idempotency.value, input.value),
		);
	},
};

/**
 * `POST /api/v1/registration-intents` (issue #4 PR-4): the trusted
 * creation route the discord adapter calls for `/register`. The fixed
 * order is wire shape → OIDC config → issuer equality → Idempotency-Key
 * → fingerprint → secret generation → S256 challenge → authorization URL
 * → the single DO RPC, so every async primitive (WebCrypto digests,
 * random generation) completes before the synchronous section begins and
 * the OIDC client secret never leaves the Worker.
 */
const registrationIntentsRoute: ServiceRoute = {
	access: "service",
	requiredCaller: DISCORD_ADAPTER_CALLER,
	unexpectedError: jsonInternalError,
	async handle({ request, url, env, caller, getStub }) {
		const body = await readJsonObject(request);
		if (!body.ok) return body.response;
		const input = validateIdentity(body.value, "body");
		if (!input.ok) return input.response;
		const config = readOidcConfig(env);
		if (config === null) return jsonInternalError();
		if (input.value.issuer !== config.issuerUrl) {
			return errorResponse(
				400,
				"invalid_request",
				"issuer is not the configured trusted issuer",
			);
		}
		const idempotency = await readIdempotency(request, url, body.value);
		if (!idempotency.ok) return idempotency.response;
		const secrets = generateRegistrationSecrets();
		const challenge = await computeProofKeyChallenge(secrets.proofKeySecret);
		const authorizationUrl = buildAuthorizationUrl(
			config.issuerUrl,
			config.clientId,
			secrets,
			challenge,
		);
		return invoke(() =>
			getStub().apiCreateRegistrationIntent(
				caller,
				idempotency.value,
				input.value,
				{ ...secrets, authorizationUrl },
			),
		);
	},
};

/**
 * `GET /auth/oidc/callback` (issue #4 PR-4): the public OIDC protocol
 * endpoint. No Bearer authentication runs; every outcome — expected or
 * unexpected — is one of the fixed static HTML pages with the fixed
 * security headers, never JSON, never a redirect.
 */
const oidcCallbackRoute: PublicRoute = {
	access: "public",
	unexpectedError: () => failurePage(500),
	handle({ url, env, getStub }) {
		return handleOidcCallback({ url, env, getStub });
	},
};

/**
 * The complete route set: exact `"METHOD pathname"` pairs only. Every
 * other method/path is `404 not_found`.
 */
const ROUTES: Readonly<Record<string, Route>> = {
	"POST /api/v1/registration-intents": registrationIntentsRoute,
	"GET /auth/oidc/callback": oidcCallbackRoute,
	"POST /api/v1/balance": internalBalanceRoute,
	"POST /api/v1/history": internalHistoryRoute,
	"POST /api/v1/transfers": internalTransfersRoute,
	"POST /api/v1/admin/issuances": adminIssueRoute,
};

/**
 * The Worker `fetch` entry: exact route match first — an unknown
 * method/path is `404 not_found` without touching authentication or the
 * `COMMUNITY_STATE` binding, so it answers identically even when `env`
 * is broken. After the match, access dispatch splits by route kind:
 * public routes run their handler directly; service routes authenticate
 * the Bearer credential (401), check it against the route's required
 * caller (403), then run the handler with the asserted caller.
 * Any unexpected exception after the match — Worker-side or RPC —
 * resolves through the route's own renderer: JSON `500 internal_error`
 * on service routes, the generic HTML 500 page on the public callback.
 */
export async function handleRequest(
	request: Request,
	env: Env,
): Promise<Response> {
	const url = new URL(request.url);
	const route = ROUTES[`${request.method} ${url.pathname}`];
	if (route === undefined) {
		return errorResponse(404, "not_found", "no such route");
	}
	const context: BaseRouteContext = {
		request,
		url,
		env,
		getStub: () => communityStub(env),
	};
	if (route.access === "public") {
		try {
			return await route.handle(context);
		} catch {
			return route.unexpectedError();
		}
	}
	try {
		const caller = await authenticate(request, {
			adminApiToken: env.ADMIN_API_TOKEN,
			discordAdapterToken: env.DISCORD_ADAPTER_SERVICE_TOKEN,
		});
		if (caller === null) {
			return errorResponse(401, "unauthorized", "authentication failed");
		}
		if (caller !== route.requiredCaller) {
			return errorResponse(
				403,
				"forbidden",
				"the caller is not authorized for this route",
			);
		}
		return await route.handle({ ...context, caller });
	} catch {
		return route.unexpectedError();
	}
}
