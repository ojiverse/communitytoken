import type { TransactionContext } from "../ports";

/**
 * The identity of one idempotent request (the idempotency specification):
 * the `(technicalCaller, idempotencyKey)` scope plus the request
 * fingerprint identifying exactly which request the key guards. Computed
 * and supplied by the trusted boundary before the serialized section runs.
 */
export type IdempotencyKeyInfo = {
	readonly technicalCaller: string;
	readonly idempotencyKey: string;
	readonly fingerprintVersion: string;
	readonly requestFingerprint: string;
};

/**
 * What the protected section produced. `record: true` marks a committed,
 * replayable mutation: `storedResult` is the serialized replay body and is
 * persisted atomically with the mutation. `record: false` marks an expected
 * outcome that committed no protected mutation (e.g. an unbound identity or
 * a kernel rejection) — it does not consume the key, so the caller may
 * retry the same key after the failure.
 */
export type IdempotentExecution<R> =
	| {
			readonly record: true;
			readonly result: R;
			readonly storedResult: string;
	  }
	| { readonly record: false; readonly result: R };

/**
 * The outcome of the idempotency choreography:
 *
 *   - `replayed` — a record for the key exists and its version+fingerprint
 *     match this request; `storedResult` is returned verbatim and the
 *     protected operation does not re-execute.
 *   - `conflict` — a record exists but the version or fingerprint differs;
 *     the key was already consumed by a different request.
 *   - `executed` — no record existed; `execute` ran inside the section and
 *     `result` is its outcome. When `execute` reported `record: true`, the
 *     replay record was inserted in the same section.
 */
export type IdempotentOutcome<R> =
	| { readonly type: "replayed"; readonly storedResult: string }
	| { readonly type: "conflict" }
	| { readonly type: "executed"; readonly result: R };

/**
 * The idempotency choreography of the idempotency specification, run inside
 * the caller's already-open section so the replay record commits atomically
 * with the protected mutation:
 *
 *   lookup -> replay on match / conflict on mismatch -> execute -> record.
 *
 * A record is created only when `execute` reports `record: true` — the
 * protected operation committed the replayable result it describes.
 * Expected outcomes that commit no protected mutation (`record: false`)
 * leave the key unconsumed and retryable. A throw anywhere in the section
 * rolls back the mutation and the record together, persisting nothing.
 */
export function executeIdempotent<R>(
	ctx: TransactionContext,
	keyInfo: IdempotencyKeyInfo,
	execute: () => IdempotentExecution<R>,
): IdempotentOutcome<R> {
	const existing = ctx.idempotencyRecords.find(
		keyInfo.technicalCaller,
		keyInfo.idempotencyKey,
	);
	if (existing !== undefined) {
		return existing.fingerprintVersion === keyInfo.fingerprintVersion &&
			existing.requestFingerprint === keyInfo.requestFingerprint
			? { type: "replayed", storedResult: existing.storedResult }
			: { type: "conflict" };
	}
	const execution = execute();
	if (execution.record) {
		ctx.idempotencyRecords.insert({
			technicalCaller: keyInfo.technicalCaller,
			idempotencyKey: keyInfo.idempotencyKey,
			fingerprintVersion: keyInfo.fingerprintVersion,
			requestFingerprint: keyInfo.requestFingerprint,
			storedResult: execution.storedResult,
			createdAt: ctx.nowMs,
		});
	}
	return { type: "executed", result: execution.result };
}
