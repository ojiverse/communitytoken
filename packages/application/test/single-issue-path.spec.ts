/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_API_CALLER, type ExternalIdentity } from "../src/types";
import { completeRegistration } from "../src/use-cases/complete-registration";
import { createRegistrationIntent } from "../src/use-cases/create-registration-intent";
import { getBalance } from "../src/use-cases/get-balance";
import { getTransactionHistory } from "../src/use-cases/get-transaction-history";
import { issueToIdentity } from "../src/use-cases/issue-to-identity";
import { transferBetweenIdentities } from "../src/use-cases/transfer-between-identities";
import { createInMemoryFixture } from "./in-memory";

const SRC = join(import.meta.dirname, "..", "src");

function sourceFiles(dir: string): readonly string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory()
			? sourceFiles(join(dir, entry.name))
			: entry.name.endsWith(".ts")
				? [join(dir, entry.name)]
				: [],
	);
}

function relative(path: string): string {
	return path.slice(SRC.length + 1);
}

/**
 * Phase 2 exposes ISSUE only through the authenticated administrative
 * issuance path (owner decision 2/5 on #25): the primitive kernel stays
 * role-agnostic, so the single-construction-path guarantee is locked at
 * the application layer — statically over the source, and behaviorally
 * over every other use case.
 */
describe("single ISSUE construction path", () => {
	it("only the administrative issuance use case invokes the primitive ISSUE operation", () => {
		const callers = sourceFiles(SRC)
			.filter((file) => /\bexecuteIssue\s*\(/.test(readFileSync(file, "utf8")))
			.map(relative)
			.sort();

		// `ledger.ts` defines it; `issue-to-identity.ts` is the only caller.
		expect(callers).toEqual([
			"use-cases/issue-to-identity.ts",
			"use-cases/ledger.ts",
		]);
	});

	it("only the primitive ledger module evaluates ISSUE through the kernel", () => {
		const evaluators = sourceFiles(SRC)
			.filter((file) => /\bevaluateIssue\b/.test(readFileSync(file, "utf8")))
			.map(relative);

		expect(evaluators).toEqual(["use-cases/ledger.ts"]);
	});

	it("registration, balance, history, and TRANSFER never record an ISSUE", () => {
		const fx = createInMemoryFixture();
		const alice = fx.seedIdentity("alice");
		const bob = fx.seedIdentity("bob");
		fx.uow.transact((ctx) =>
			issueToIdentity(ctx, ADMIN_API_CALLER, {
				target: alice.identity,
				amount: 10,
			}),
		);
		function issueCount(): number {
			return fx.state.transactionRows.filter(
				({ record }) => record.kind === "ISSUE",
			).length;
		}
		const before = issueCount();
		const carol: ExternalIdentity = {
			issuer: "https://issuer.test",
			subject: "carol",
		};

		fx.uow.transact((ctx) =>
			createRegistrationIntent(ctx, {
				expectedIssuer: carol.issuer,
				expectedSubject: carol.subject,
				state: "state-carol",
				nonce: "nonce",
				proofKeySecret: "proof",
			}),
		);
		fx.uow.transact((ctx) =>
			completeRegistration(ctx, {
				state: "state-carol",
				verifiedIssuer: carol.issuer,
				verifiedSubject: carol.subject,
			}),
		);
		fx.uow.transact((ctx) => getBalance(ctx, alice.identity));
		fx.uow.transact((ctx) => getTransactionHistory(ctx, alice.identity, {}));
		fx.uow.transact((ctx) =>
			transferBetweenIdentities(ctx, {
				from: alice.identity,
				to: bob.identity,
				amount: 4,
			}),
		);
		fx.uow.transact((ctx) =>
			transferBetweenIdentities(ctx, {
				from: bob.identity,
				to: carol,
				amount: 1,
			}),
		);

		expect(issueCount()).toBe(before);
		expect(fx.state.transactionRows.length).toBe(before + 2);
	});
});
