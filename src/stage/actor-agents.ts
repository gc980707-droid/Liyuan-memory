/**
 * 导演层 + 角色 agent 的最小协议。
 *
 * 角色 agent 只提交「我会怎么回应」，最后仍由正文工件流程统一合成和验收。
 */

import type { CharacterCard, CharacterState, WorldState } from "../types.ts";

export interface ActorProfile {
	name: string;
	/** 角色卡/世界书提供的稳定身份与说话基调 */
	identity: string;
	/** 角色当前知道的事实；不等于共享世界全量事实 */
	knownFacts: string[];
	/** 私有目标、顾虑、秘密和关系判断 */
	privateState: string;
	/** 角色不应知道的内容，供导演和 agent 做信息隔离 */
	blindSpots: string[];
	/** 当前关系状态（可选，来自世界状态） */
	state?: CharacterState;
}

export interface DirectorDecision {
	activeActors: string[];
	turnFocus: string;
	stopAt: string;
}

export interface ActorProposal {
	actor: string;
	content: string;
	intendedAction: string;
	confidence?: number;
}

export interface ActorAgent {
	profile: ActorProfile;
	respond: (input: {
		userText: string;
		recentText: string;
		sharedState: Pick<WorldState, "time" | "location">;
	}) => Promise<ActorProposal>;
}

/**
 * 从共享状态建立角色档案。共享世界只放客观时空；每个角色的主观信息
 * 由上层后续从角色卡/世界书/记忆中填入，不能把全量世界状态直接塞给每个 agent。
 */
export function actorProfilesFromState(
	card: CharacterCard,
	state: WorldState,
	knownFactsByActor: Record<string, string[]> = {},
	privateStateByActor: Record<string, string> = {},
): ActorProfile[] {
	const names = [card.name, ...Object.keys(state.characters).filter((n) => n !== card.name)];
	return names.map((name) => ({
		name,
		identity:
			name === card.name
				? [card.description, card.personality, card.scenario].filter(Boolean).join("\n")
				: state.roster?.characters?.[name] || "（角色档案待补充）",
		knownFacts: [
			...(knownFactsByActor[name] ?? []),
			...(state.characters[name]?.status ? [`当前状态：${state.characters[name].status}`] : []),
			...(state.characters[name]?.notes ? [`已记录事项：${state.characters[name].notes}`] : []),
		],
		privateState: privateStateByActor[name] ?? state.characters[name]?.notes ?? "",
		blindSpots: ["不知道其他角色未公开的内心、秘密和决定"],
		...(state.characters[name] ? { state: state.characters[name] } : {}),
	}));
}

/**
 * 第一版导演：确定性筛选，避免同一轮无意义地唤醒所有角色。
 * - 用户明确点名的角色优先；
 * - 没点名时由主角色承接；
 * - 最近正文里出现的角色可一并入场，但最多两名，避免群聊失控。
 */
export function selectActiveActors(
	profiles: ActorProfile[],
	userText: string,
	recentText = "",
): DirectorDecision {
	if (profiles.length === 0) return { activeActors: [], turnFocus: "无角色可调度", stopAt: "交还用户" };
	const source = `${userText}\n${recentText}`;
	const mentioned = profiles.filter((p) => source.includes(p.name));
	const chosen = mentioned.length > 0 ? mentioned : profiles.slice(0, 1);
	const activeActors = chosen.slice(0, 2).map((p) => p.name);
	return {
		activeActors,
		turnFocus: userText.trim() || "回应当前现场",
		stopAt: "一个角色反应完成、用户仍可自然接话处",
	};
}

export function buildDirectorPrompt(decision: DirectorDecision, profiles: ActorProfile[]): string {
	const roster = profiles
		.filter((p) => decision.activeActors.includes(p.name))
		.map((p) => `- ${p.name}：${p.identity || "（无身份摘要）"}`)
		.join("\n");
	return `你是本轮剧情导演，只负责调度，不写正文。\n当前焦点：${decision.turnFocus}\n本轮可回应角色：\n${roster || "- （无）"}\n只让上述角色回应；停在：${decision.stopAt}。用户角色的台词、动作、想法和决定永远由用户本人提供。`;
}

export function buildActorPrompt(profile: ActorProfile, decision: DirectorDecision): string {
	return `你是角色 agent「${profile.name}」，只从这个角色的主观位置回应。\n身份与语气：${profile.identity || "（未提供）"}\n你知道：${profile.knownFacts.join("；") || "（仅知道当前现场）"}\n你的私有状态：${profile.privateState || "（无）"}\n你的盲区：${profile.blindSpots.join("；") || "不要擅自推断他人内心"}\n事实纪律：未列出的事实一律视为未知；不要从“加盟、借款、电话”等词推断行业、店铺类型、地点、人物关系或他人动机；不确定就保持模糊。\n本轮导演焦点：${decision.turnFocus}\n只提交这个角色的一个反应和一个行动意图，不写其他角色，不写用户，不替用户做决定。`;
}

/** 把角色提案作为事实材料交给正文模型；提案不是已发生正文，也不能覆盖用户主权。 */
export function formatActorProposals(proposals: ActorProposal[]): string {
	if (proposals.length === 0) return "";
	return `【角色 agent 提案】\n${proposals
		.map((p) => `- ${p.actor}：${p.content}${p.intendedAction ? `（行动意图：${p.intendedAction}）` : ""}`)
		.join("\n")}\n以上只是各角色的主观提案；正文模型负责取舍和落稿，不把提案当成用户已做出的动作或决定。`;
}

export async function runActorAgents(
	decision: DirectorDecision,
	agents: ActorAgent[],
	input: { userText: string; recentText: string; sharedState: Pick<WorldState, "time" | "location"> },
): Promise<ActorProposal[]> {
	const active = new Set(decision.activeActors);
	const selected = agents.filter((a) => active.has(a.profile.name));
	// 角色之间暂不并行写正文：保留导演顺序，后续可在合成层引入并行提案。
	const out: ActorProposal[] = [];
	for (const agent of selected) out.push(await agent.respond(input));
	return out;
}
