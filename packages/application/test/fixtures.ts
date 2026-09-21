import type {
	Actor,
	AdminActor,
	ServiceActor,
	SystemActor,
	UserActor,
} from "../src/types";
import { ADMIN_API_PRINCIPAL, userId } from "../src/types";

/** The actor/visibility specification administrative actor bound to the `/api/v1/admin/*` boundary in tests. */
export const ADMIN: AdminActor = {
	kind: "service",
	principalId: ADMIN_API_PRINCIPAL,
};

/** A non-administrative service principal, e.g. a future `discord-adapter` credential. */
export const OTHER_SERVICE: ServiceActor = {
	kind: "service",
	principalId: "other-service",
};

/** A system actor: reserved for scheduled/policy initiators (the actor/visibility specification). */
export const SYSTEM: SystemActor = { kind: "system" };

/** A user actor for `rawUserId`. */
export function userActor(rawUserId: string): UserActor {
	return { kind: "user", userId: userId(rawUserId) };
}

/**
 * Views `actor` as an `AdminActor`: the untyped-caller escape used to test
 * the runtime guards that backstop the typed administrative boundary.
 */
export function asAdmin(actor: Actor): AdminActor {
	return actor as AdminActor;
}

/**
 * Views `actor` as a `UserActor`: the untyped-caller escape used to test the
 * runtime guards that backstop the typed user boundary.
 */
export function asUser(actor: Actor): UserActor {
	return actor as UserActor;
}
