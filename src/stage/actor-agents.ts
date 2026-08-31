/**
 * 导演层 + 角色 agent 的最小协议。
 *
 * 角色 agent 只提交「我会怎么回应」，最后仍由正文工件流程统一合成和验收。
 */

import type { ActorProfileOverrides } from "../actor-profiles.ts";
import type { CharacterCard, CharacterState, LorebookEntry, SceneState, WorldState } from "../types.ts";

export interface ActorProfile {
	name: string;
	/** 可选独立角色卡路径（相对项目根）；缺省使用主卡/档案字段。 */
	cardPath?: string;
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
	/** 导演给正文模型的节奏锚点；不是已经发生的剧情事实。 */
	sceneGoal?: string;
	tension?: number;
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
		sharedState: Pick<WorldState, "time" | "location"> & { scene?: SceneState };
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
	loreEntries: LorebookEntry[] = [],
	profileOverrides: Record<string, ActorProfileOverrides> = {},
): ActorProfile[] {
	const names = [card.name, ...Object.keys(state.characters).filter((n) => n !== card.name)];
	return names.map((name) => {
		const loreFacts = [...card.book, ...loreEntries]
			.filter((entry) => `${entry.comment}\n${entry.content}`.includes(name))
			.map((entry) => `设定事实：${entry.comment ? `【${entry.comment}】` : ""}${entry.content}`);
		const override = profileOverrides[name] ?? {};
		return {
		name,
		identity:
			name === card.name
				? [card.description, card.personality, card.scenario].filter(Boolean).join("\n")
				: state.roster?.characters?.[name] || "（角色档案待补充）",
		knownFacts: [
			...(knownFactsByActor[name] ?? []),
			...loreFacts,
			...(state.characters[name]?.status ? [`当前状态：${state.characters[name].status}`] : []),
			...(state.characters[name]?.notes ? [`已记录事项：${state.characters[name].notes}`] : []),
			...(override.knownFacts ?? []),
		],
		privateState: privateStateByActor[name] ?? state.characters[name]?.notes ?? "",
		blindSpots: ["不知道其他角色未公开的内心、秘密和决定"],
		...(state.characters[name] ? { state: state.characters[name] } : {}),
			...(override.identity !== undefined ? { identity: override.identity } : {}),
			...(override.card ? { cardPath: override.card } : {}),
		...(override.privateState !== undefined ? { privateState: override.privateState } : {}),
		...(override.blindSpots !== undefined ? { blindSpots: override.blindSpots } : {}),
		};
	});
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
	if (profiles.length === 0) return { activeActors: [], turnFocus: "无角色可调度", stopAt: "角色动作或情绪自然停顿" };
	const source = `${userText}\n${recentText}`;
	const mentioned = profiles.filter((p) => source.includes(p.name));
	const chosen = mentioned.length > 0 ? mentioned : profiles.slice(0, 1);
	const activeActors = chosen.slice(0, 2).map((p) => p.name);
	return {
		activeActors,
		turnFocus: userText.trim() || "回应当前现场",
		stopAt: "一个角色反应完成、在角色自己的动作或情绪自然停顿处收束",
	};
}

export function buildDirectorPrompt(decision: DirectorDecision, profiles: ActorProfile[]): string {
	const roster = profiles
		.filter((p) => decision.activeActors.includes(p.name))
		.map((p) => `- ${p.name}：${p.identity || "（无身份摘要）"}`)
		.join("\n");
	const pacing = [
		decision.sceneGoal ? `场景目标：${decision.sceneGoal}` : "",
		typeof decision.tension === "number" ? `冲突强度：${decision.tension}/5` : "",
	].filter(Boolean).join("\n");
	return `你是本轮剧情导演，只负责调度，不写正文。\n当前焦点：${decision.turnFocus}\n${pacing ? `${pacing}\n` : ""}本轮可回应角色：\n${roster || "- （无）"}\n只让上述角色回应；停在：${decision.stopAt}。用户角色的台词、动作、想法和决定永远由用户本人提供。`;
}

export function buildDirectorSelectionPrompt(profiles: ActorProfile[], scene?: SceneState): string {
	const roster = profiles.map((p) => `- ${p.name}：${p.identity || "（无身份摘要）"}`).join("\n");
	const continuity = scene && scene.ongoing.length > 0
		? `\n当前场景的进行中动作（优先级最高，必须在本轮继续）：${scene.ongoing.join("；")}。除非用户或正文明确完成、取消或改道，导演不得安排角色离开、停摆或另起一条动作。`
		: "";
	return `你是剧情导演，只负责本轮调度，不写正文。\n角色名录：\n${roster || "- （无角色）"}${continuity}\n根据用户最新输入、最近正文和场景连续性，选择本轮真正需要回应的角色（最多两个），并控制节奏。输出严格 JSON：{"activeActors":["角色名"],"turnFocus":"本轮焦点","stopAt":"停点","sceneGoal":"本轮希望推进的场景目标","tension":1}。tension 只能是 1 到 5；只能选择名录中的角色；不能替用户做决定，也不能把计划写成已发生事实。进行中动作存在时，turnFocus 必须包含“在该动作上继续回应”，不能把它当作背景后跳开。`;
}

export function parseDirectorDecision(text: string, profiles: ActorProfile[], fallback: DirectorDecision, scene?: SceneState): DirectorDecision {
	const match = text.match(/\{[\s\S]*\}/);
	if (!match) return fallback;
	try {
		const raw = JSON.parse(match[0]) as Partial<DirectorDecision>;
		const names = new Set(profiles.map((p) => p.name));
			let activeActors = Array.isArray(raw.activeActors)
				? raw.activeActors.filter((n): n is string => typeof n === "string" && names.has(n)).slice(0, 2)
				: [];
			if (scene?.ongoing.length) {
				const ongoingActors = profiles.filter((p) => scene.ongoing.some((item) => item.includes(p.name))).map((p) => p.name);
				for (const name of ongoingActors) {
					if (!activeActors.includes(name)) activeActors = [...activeActors.slice(0, 1), name].slice(0, 2);
				}
			}
		if (activeActors.length === 0) return fallback;
		return {
			activeActors,
			turnFocus: typeof raw.turnFocus === "string" && raw.turnFocus.trim() ? raw.turnFocus : fallback.turnFocus,
			stopAt: typeof raw.stopAt === "string" && raw.stopAt.trim() ? raw.stopAt : fallback.stopAt,
			...(typeof raw.sceneGoal === "string" && raw.sceneGoal.trim() ? { sceneGoal: raw.sceneGoal.trim().slice(0, 240) } : {}),
			...(typeof raw.tension === "number" && Number.isFinite(raw.tension) ? { tension: Math.max(1, Math.min(5, Math.round(raw.tension))) } : {}),
		};
	} catch {
		return fallback;
	}
}

export function buildActorPrompt(profile: ActorProfile, decision: DirectorDecision, scene?: SceneState): string {
	const ledger = profile.state
		? `当前账本（只读）：状态=${profile.state.status || "未记录"}；关系值=${profile.state.affinity}；备注=${profile.state.notes || "无"}`
		: "当前账本（只读）：该角色没有单独的状态记录";
	const sceneFacts = scene
		? `当前场景连续性（共享只读事实）：位置=${Object.entries(scene.positions).map(([n, v]) => `${n}=${v}`).join("；") || "未记录"}；手上物件=${Object.entries(scene.held_items).map(([n, v]) => `${n}=${v}`).join("；") || "未记录"}；进行中=${scene.ongoing.join("；") || "无"}；已知=${scene.known_facts.join("；") || "无"}`
		: "当前场景连续性（共享只读事实）：未提供，不得自行补全";
	return `你是角色 agent「${profile.name}」，只从这个角色的主观位置回应。你不是正文作者，也不是导演；你只能提交这个角色的一条反应和一个动作意图，不能替用户或其他角色补台词、动作、想法和事实。\n身份与语气：${profile.identity || "（未提供）"}\n你知道：${profile.knownFacts.join("；") || "（仅知道当前现场）"}\n你的私有状态：${profile.privateState || "（无）"}\n你的盲区：${profile.blindSpots.join("；") || "不要擅自推断他人内心"}\n${ledger}\n${sceneFacts}\n场景中的“进行中”动作是本轮最高优先级的连续性约束：除非用户或正文明确完成、取消或改道，不得用临时提案让角色放弃它、离开或停摆；必须先在该动作上做一个具体的可见推进，再回应用户。若用户只是走近、说饿了或改变位置，这不等于取消角色正在做的事。身份与语气、已知事实和私有状态也是稳定约束；如果其中明确写有长期家暴/创伤经历，必须带入本轮判断，不能因用户一句日常需求就把她改写成从容熟练、无条件照料他人的角色。具体反应仍以档案为准，不要套固定的哭泣、道歉或害怕模板；本轮只提议一个可见反应和一个动作，提到一次迟疑/道歉/观察脸色后就推进，不要连续重复同一种创伤反应。\n事实纪律：未列出的事实一律视为未知；不要从“加盟、借款、电话”等词推断行业、店铺类型、地点、人物关系或他人动机；不确定就保持模糊。状态变化只是意图，必须由正文模型通过状态工具确认后才算发生。\n本轮导演焦点：${decision.turnFocus}\n只输出严格 JSON：{"actor":"${profile.name}","content":"这个角色此刻的反应","intendedAction":"这个角色准备做的一个动作"}。content 只写这个角色当前可见的反应，不写其他角色，不写用户，不替用户做决定，不把动作意图当成已经发生的事实。`;
}

/** 角色提案的宽容解析：模型偶尔多说一句时只保留可用字段，避免把协议污染正文。 */
export function parseActorProposal(text: string, profile: ActorProfile): ActorProposal {
	const match = text.match(/\{[\s\S]*\}/);
	if (match) {
		try {
			const raw = JSON.parse(match[0]) as Partial<ActorProposal>;
			if (raw.actor === profile.name && typeof raw.content === "string" && raw.content.trim()) {
				return {
					actor: profile.name,
					content: raw.content.trim(),
					intendedAction: typeof raw.intendedAction === "string" ? raw.intendedAction.trim() : "",
				};
			}
		} catch {
			/* 回退为该角色的自由文本提案 */
		}
	}
	return { actor: profile.name, content: text.trim(), intendedAction: "" };
}

const CONTRADICTORY_ACTIONS: Array<[RegExp, RegExp, string]> = [
	[/离开|走开|转身离去/u, /留下|停下|不走/u, "离开与留下"],
	[/攻击|拔刀|开枪|出手/u, /停手|收手|不攻击/u, "攻击与停手"],
	[/接受|答应|同意/u, /拒绝|否认|不同意/u, "接受与拒绝"],
	[/打开|解锁|放行/u, /关闭|锁上|拦住/u, "打开与关闭"],
];

/** 检测角色提案之间的明显互斥意图；这里只产生提醒，不替正文模型强行改写剧情。 */
export function findProposalConflicts(proposals: ActorProposal[]): string[] {
	const warnings: string[] = [];
	const seenActors = new Set<string>();
	for (const proposal of proposals) {
		if (seenActors.has(proposal.actor)) warnings.push(`角色「${proposal.actor}」出现重复提案`);
		seenActors.add(proposal.actor);
	}
	for (let i = 0; i < proposals.length; i++) {
		for (let j = i + 1; j < proposals.length; j++) {
			const left = `${proposals[i]!.content} ${proposals[i]!.intendedAction}`;
			const right = `${proposals[j]!.content} ${proposals[j]!.intendedAction}`;
			for (const [a, b, label] of CONTRADICTORY_ACTIONS) {
				if ((a.test(left) && b.test(right)) || (b.test(left) && a.test(right))) {
					warnings.push(`「${proposals[i]!.actor}」与「${proposals[j]!.actor}」存在${label}冲突`);
				}
			}
		}
	}
	return warnings;
}

/** 把角色提案作为事实材料交给正文模型；提案不是已发生正文，也不能覆盖用户主权。 */
export function formatActorProposals(proposals: ActorProposal[]): string {
	if (proposals.length === 0) return "";
	const conflicts = findProposalConflicts(proposals);
	return `【角色 agent 提案｜非事实材料】
以下内容只是各角色对本轮的候选反应。它们不是已经发生的正文，也不是场景账本；尤其“行动意图”只是可能方向。除非最近正文、场景账本或用户本轮原话已经明确支持，否则主回复 Agent 必须舍弃该意图，不得把它写成已发生动作。
${proposals
		.map((p) => `- ${p.actor}：候选反应=${p.content}${p.intendedAction ? `；可能方向（非事实）=${p.intendedAction}` : ""}`)
		.join("\n")}${conflicts.length > 0 ? `
【提案冲突提醒】
${conflicts.map((x) => `- ${x}`).join("\n")}` : ""}
正文模型负责取舍和落稿，不把提案当成用户已做出的动作或决定。但场景账本中的“进行中”动作是连续性约束，不是可选建议：没有明确完成、取消或改道时，必须在正文中保留并推进该动作。冲突时保留不确定性，不擅自替用户选择。`;
}

export async function runActorAgents(
	decision: DirectorDecision,
	agents: ActorAgent[],
	input: { userText: string; recentText: string; sharedState: Pick<WorldState, "time" | "location"> & { scene?: SceneState } },
): Promise<ActorProposal[]> {
	const active = new Set(decision.activeActors);
	const selected = agents.filter((a) => active.has(a.profile.name));
	// 角色之间暂不并行写正文：保留导演顺序，后续可在合成层引入并行提案。
	const out: ActorProposal[] = [];
	for (const agent of selected) out.push(await agent.respond(input));
	return out;
}
