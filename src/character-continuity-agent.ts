import type { MvuOperation } from "./mvu.ts";

/** 提取角色长期目标、关系和未完成事项；只产出结构化补丁。 */
export function buildCharacterContinuityPrompt(input: {
	userText: string;
	narrative: string;
	currentMvu: string;
	characterNames: string[];
	characterProfiles?: Record<string, string>;
}): { systemPrompt: string; userText: string } {
	const profiles = Object.entries(input.characterProfiles ?? {})
		.filter(([name, content]) => input.characterNames.includes(name) && content.trim())
		.map(([name, content]) => `【${name}】\n${content.trim().slice(0, 2400)}`)
		.join("\n\n");
	return {
		systemPrompt: `你是角色连续性 Agent。只从本轮用户输入和已生成正文中提取明确发生的长期目标、关系变化和未完成事项，输出唯一 JSON：{"operations":[{"op":"replace|insert|remove","path":"/characters/角色/字段","value":...}]}。

只允许更新角色的 goals、relationships、open_threads 三类字段；没有明确变化就输出 {"operations":[]}。不要根据档案猜测，不要写正文，不要修改时间、地点、物品、数值好感或世界正典。角色范围：${input.characterNames.join("、") || "（无）"}。${profiles ? `\n\n世界书档案仅作背景参考：\n${profiles}` : ""}`,
		userText: `【本轮用户输入】\n${input.userText}\n\n【本轮正文】\n${input.narrative}\n\n【当前 MVU】\n${input.currentMvu}`,
	};
}

export function parseCharacterContinuityAgent(text: string): MvuOperation[] | null {
	let source = text.trim();
	const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fenced) source = fenced[1].trim();
	const start = source.indexOf("{");
	const end = source.lastIndexOf("}");
	if (start < 0 || end <= start) return null;
	try {
		const raw = JSON.parse(source.slice(start, end + 1)) as { operations?: unknown };
		if (!Array.isArray(raw.operations)) return null;
		return raw.operations.filter((operation): operation is MvuOperation => {
			if (!operation || typeof operation !== "object") return false;
			const item = operation as MvuOperation;
			return (item.op === "replace" || item.op === "insert" || item.op === "remove") &&
				typeof item.path === "string" && /^\/characters\/[^/]+\/(goals|relationships|open_threads)(\/|$)/.test(item.path);
		}).slice(0, 60);
	} catch {
		return null;
	}
}
