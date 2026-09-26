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
/** The production Worker / Durable Object source consuming this package. */
const APP_SRC = join(
	import.meta.dirname,
	"..",
	"..",
	"..",
	"apps",
	"communitytoken",
	"src",
);

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
	return path.startsWith(APP_SRC)
		? `app:${path.slice(APP_SRC.length + 1)}`
		: path.slice(SRC.length + 1);
}

/** Every production source file of this package and of the app. */
function productionSources(): readonly string[] {
	return [...sourceFiles(SRC), ...sourceFiles(APP_SRC)];
}

function filesMatching(pattern: RegExp): readonly string[] {
	return productionSources()
		.filter((file) => pattern.test(readFileSync(file, "utf8")))
		.map(relative)
		.sort();
}

/**
 * Phase 2 exposes ISSUE only through the authenticated administrative
 * issuance path (owner decision 2/5 on #25): the primitive kernel stays
 * role-agnostic, so the single-construction-path guarantee is locked at
 * the application layer — statically over this package's and the
 * production app's source, and behaviorally over every other use case.
 */
describe("single ISSUE construction path", () => {
	it("only the administrative issuance use case invokes the primitive ISSUE operation, in the package and the app", () => {
		// `ledger.ts` defines it; `issue-to-identity.ts` is the only caller.
		expect(filesMatching(/\bexecuteIssue\s*\(/)).toEqual([
			"use-cases/issue-to-identity.ts",
			"use-cases/ledger.ts",
		]);
	});

	it("only the primitive ledger module evaluates ISSUE or appends Transactions", () => {
		expect(filesMatching(/\bevaluateIssue\b/)).toEqual(["use-cases/ledger.ts"]);
		expect(filesMatching(/\btransactions\.insert\s*\(/)).toEqual([
			"use-cases/ledger.ts",
		]);
	});

	it("the app reaches ISSUE only through the administrative issuance use case", () => {
		expect(filesMatching(/\bissueToIdentity\s*\(/)).toEqual([
			"app:community-state.ts",
			"use-cases/issue-to-identity.ts",
		]);
		expect(filesMatching(/INSERT INTO transactions/i)).toEqual([
			"app:repositories.ts",
		]);
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
