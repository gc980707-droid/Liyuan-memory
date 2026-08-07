import type { MvuOperation } from "./mvu.ts";

export function buildCharacterStatePrompt(input: { userText: string; narrative: string; currentMvu: string; characterNames: string[] }): { systemPrompt: string; userText: string } {
	return {
		systemPrompt: `你是独立角色状态 Agent。只从本轮用户输入和已生成正文中提取持久状态变化，输出唯一 JSON：{"operations":[{"op":"replace|delta|insert|remove|move","path":"/角色/字段","value":...}]}。只更新正文明确支持的事实；没有变化输出 {"operations":[]}。不要写正文、解释、Markdown 或工具调用。只处理这些核心角色：${input.characterNames.join("、") || "（无）"}。不得修改时间，时间由时间门禁处理。`,
		userText: `【本轮用户输入】\n${input.userText}\n\n【本轮正文】\n${input.narrative}\n\n【当前 MVU】\n${input.currentMvu}`,
	};
}

export function parseCharacterStateAgent(text: string): MvuOperation[] | null {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start < 0 || end <= start) return null;
	try {
		const raw = JSON.parse(text.slice(start, end + 1)) as { operations?: unknown };
		if (!Array.isArray(raw.operations)) return null;
		return raw.operations.filter((operation): operation is MvuOperation => !!operation && typeof operation === "object").slice(0, 100);
	} catch {
		return null;
	}
}
