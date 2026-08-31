import { formatState } from "../state.ts";
import type { WorldState } from "../types.ts";

export interface SceneAgentInput {
	state: WorldState;
	userText: string;
	recentText: string;
	charName: string;
	userName: string;
}

export interface SceneAgentResult {
	patch: Record<string, unknown>;
	explicitActions: string[];
	explicitNeeds: string[];
}

/** Keep the scene agent on its narrow write surface before applyPatch sees it. */
export function sanitizeScenePatch(patch: Record<string, unknown>, hasExplicitInput: boolean): Record<string, unknown> {
	if (!hasExplicitInput || !patch.scene || typeof patch.scene !== "object" || Array.isArray(patch.scene)) return {};
	const raw = patch.scene as Record<string, unknown>;
	const scene: Record<string, unknown> = {};
	for (const key of ["positions", "held_items"]) {
		if (!raw[key] || typeof raw[key] !== "object" || Array.isArray(raw[key])) continue;
		const values: Record<string, string | null> = {};
		for (const [name, value] of Object.entries(raw[key] as Record<string, unknown>)) {
			if (typeof name === "string" && (typeof value === "string" || value === null)) values[name] = value;
		}
		if (Object.keys(values).length) scene[key] = values;
	}
	for (const key of ["ongoing", "known_facts"]) {
		if (!Array.isArray(raw[key])) continue;
		const values = raw[key].filter((x): x is string => typeof x === "string" && x.trim()).map((x) => x.trim()).slice(0, 100);
		if (values.length) scene[key] = values;
	}
	return Object.keys(scene).length ? { scene } : {};
}

export function buildSceneAgentPrompt(input: SceneAgentInput): { systemPrompt: string; userText: string } {
	const systemPrompt = [
		"你是角色扮演的场景记录员，只做事实提取，不写正文，不替任何人做决定。",
		"阅读当前账本、最近正文和用户最新输入，输出 JSON。只记录用户明确说出或明确做出的内容，不根据常见剧情套路补全。",
		"explicit_actions：用户本轮明确做出的动作；没有就填 []。不要把角色卡或助手正文里的‘你……’当成用户动作，也不要替用户补动作、台词或意图。",
		"explicit_needs：用户本轮明确表达的需求或状态，例如‘我饿了’应记录为‘用户表示饿了’；没有就填 []。不要把需求擅自扩展成用户指定的方案。",
		"patch.scene：只在场景事实确实变化时填写。positions/held_items 按人物合并，值为字符串或 null；ongoing/known_facts 是完整字符串数组。电话刚挂断且没有写放下时，手机仍属于原持有者；不要凭空添加抹布、厨房或其他道具。",
		"不确定就省略 patch.scene，完全没有变化时 patch 为 {}。",
		"只输出 JSON 对象，不要输出解释。",
	].join("\n");
	const userText = [
		"【当前账本】",
		formatState(input.state),
		"",
		"【最近正文】",
		input.recentText || "（无）",
		"",
		"【用户最新输入】",
		`${input.userName}：${input.userText}`,
		"",
		`【角色】${input.charName}`,
	].join("\n");
	return { systemPrompt, userText };
}

export function parseSceneAgentResult(text: string): SceneAgentResult | null {
	let value = text.trim();
	const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/u);
	if (fenced) value = fenced[1]!.trim();
	const start = value.indexOf("{");
	const end = value.lastIndexOf("}");
	if (start < 0 || end <= start) return null;
	try {
		const raw = JSON.parse(value.slice(start, end + 1)) as Record<string, unknown>;
		const patch = raw.patch && typeof raw.patch === "object" && !Array.isArray(raw.patch) ? raw.patch : {};
		const strings = (key: string) =>
			Array.isArray(raw[key]) ? raw[key].filter((x): x is string => typeof x === "string" && x.trim()).map((x) => x.trim()) : [];
		return { patch: patch as Record<string, unknown>, explicitActions: strings("explicit_actions"), explicitNeeds: strings("explicit_needs") };
	} catch {
		return null;
	}
}
