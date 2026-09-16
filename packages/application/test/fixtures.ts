import type { Actor } from "../src/types";

/** The §13 service actor bound to the administrative boundary in tests. */
export const ADMIN: Actor = { kind: "service", principalId: "admin-api" };

/** A second service principal: bearer identity is a boundary concern, not a domain rule. */
export const OTHER_SERVICE: Actor = {
	kind: "service",
	principalId: "other-service",
};

/** A system actor: reserved for scheduled/policy initiators (issue #4 §13). */
export const SYSTEM: Actor = { kind: "system" };

/** A user actor for `userId`. */
export function userActor(userId: string): Actor {
	return { kind: "user", userId };
}
