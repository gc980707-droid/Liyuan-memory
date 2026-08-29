/**
 * 角色 agent 的本地独立档案。它和会话状态分开：state 记录当前发生了什么，
 * 这里记录角色是谁、知道什么、在意什么以及明确不知道什么。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ActorProfile } from "./stage/actor-agents.ts";

export const ACTOR_PROFILES_FILE = ".liyuan-actor-profiles.json";
export type ActorProfileOverrides = Partial<Pick<ActorProfile, "identity" | "knownFacts" | "privateState" | "blindSpots">>;

const isStringArray = (x: unknown): x is string[] => Array.isArray(x) && x.every((v) => typeof v === "string");

export function loadActorProfileOverrides(cwd: string): Record<string, ActorProfileOverrides> {
	const path = join(cwd, ACTOR_PROFILES_FILE);
	if (!existsSync(path)) return {};
	try {
		const raw = JSON.parse(readFileSync(path, "utf8")) as { actors?: unknown };
		if (!raw.actors || typeof raw.actors !== "object" || Array.isArray(raw.actors)) return {};
		const out: Record<string, ActorProfileOverrides> = {};
		for (const [name, value] of Object.entries(raw.actors as Record<string, unknown>)) {
			if (!value || typeof value !== "object" || !name.trim()) continue;
			const v = value as Record<string, unknown>;
			const profile: ActorProfileOverrides = {};
			if (typeof v.identity === "string") profile.identity = v.identity;
			if (isStringArray(v.knownFacts)) profile.knownFacts = v.knownFacts;
			if (typeof v.privateState === "string") profile.privateState = v.privateState;
			if (isStringArray(v.blindSpots)) profile.blindSpots = v.blindSpots;
			if (Object.keys(profile).length > 0) out[name] = profile;
		}
		return out;
	} catch {
		return {};
	}
}
