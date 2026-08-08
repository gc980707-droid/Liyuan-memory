import { inferActionDuration, type ActionDuration } from "./time-gate.ts";

export type TurnKind = "simple_action" | "story" | "backstage";

export interface TurnPlan {
	kind: TurnKind;
	userText: string;
	affectedCharacters: string[];
	actionDuration: ActionDuration | null;
	constraints: string[];
	approved: boolean;
}

export function classifyTurn(userText: string, backstage: boolean): TurnKind {
	if (backstage) return "backstage";
	const text = userText.trim();
	if (/^(?:起来|起身|走到|回到|拿起|放下|坐下|站起|打开|关上|看一眼|喝水|吃东西|上厕所)/u.test(text) && text.length <= 40) return "simple_action";
	return "story";
}

export function buildTurnPlan(userText: string, characterNames: string[], backstage = false): TurnPlan {
	const kind = classifyTurn(userText, backstage);
	const affectedCharacters = characterNames.filter((name) => userText.includes(name));
	if (affectedCharacters.length === 0 && kind !== "backstage") affectedCharacters.push(...characterNames.slice(0, 1));
	const actionDuration = inferActionDuration(userText);
	const constraints = [
		"世界状态中的时间、地点、角色和物品是硬约束。",
		"不得引入未在场角色，不得替用户角色做未授权的决定。",
	];
	if (kind === "simple_action") constraints.push("这是低能量过场，保持简短，不要凭空升级为重大事件。");
	if (actionDuration) constraints.push(`动作「${actionDuration.name}」自然耗时约 ${actionDuration.min}～${actionDuration.max} 分钟。`);
	return { kind, userText: userText.trim(), affectedCharacters, actionDuration, constraints, approved: true };
}

export function formatTurnPlan(plan: TurnPlan): string {
	return JSON.stringify(plan, null, 2);
}
