export interface SceneStateAdvice {
	present: string[];
	focus: string;
	background: string[];
	knowledgeBoundaries: string[];
}

export function buildSceneStatePrompt(input: {
	text: string;
	characterNames: string[];
	worldState: string;
	characterProfiles?: Record<string, string>;
}): { systemPrompt: string; userText: string } {
	const profiles = Object.entries(input.characterProfiles ?? {})
		.filter(([name]) => input.characterNames.includes(name))
		.map(([name, content]) => `【${name}】\n${content.slice(0, 1800)}`)
		.join("\n\n");
	return {
		systemPrompt: `你是场景状态 Agent。只分析当前场景，不写正文、不修改状态、不调用工具。输出唯一 JSON：{"present":[],"focus":"","background":[],"knowledgeBoundaries":[]}。present 只列当前确实在场或正在参与的角色；focus 只填当前镜头焦点；background 列在场但不应单独驱动剧情的角色；knowledgeBoundaries 列角色明确不知道的信息。只能从输入和世界状态判断，不要凭世界书档案创造出场。候选角色：${input.characterNames.join("、") || "（无）"}。${profiles ? `\n\n角色档案仅用于辨认角色：\n${profiles}` : ""}`,
		userText: `【当前文本】\n${input.text}\n\n【世界状态】\n${input.worldState}`,
	};
}

export function parseSceneStateAdvice(text: string): SceneStateAdvice | null {
	let source = text.trim();
	const fence = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fence) source = fence[1].trim();
	const start = source.indexOf("{");
	const end = source.lastIndexOf("}");
	if (start < 0 || end <= start) return null;
	try {
		const raw = JSON.parse(source.slice(start, end + 1)) as Record<string, unknown>;
		const strings = (value: unknown) => Array.isArray(value) ? value.filter((x): x is string => typeof x === "string" && x.trim()).map((x) => x.trim()).slice(0, 20) : [];
		return {
			present: strings(raw.present),
			focus: typeof raw.focus === "string" ? raw.focus.trim().slice(0, 120) : "",
			background: strings(raw.background),
			knowledgeBoundaries: strings(raw.knowledgeBoundaries ?? raw.knowledge_boundaries),
		};
	} catch {
		return null;
	}
}

export function formatSceneStateAdvice(advice: SceneStateAdvice, allowedNames: string[]): string {
	const allowed = new Set(allowedNames);
	const present = advice.present.filter((name) => allowed.has(name));
	const background = advice.background.filter((name) => present.includes(name));
	const focus = allowed.has(advice.focus) ? advice.focus : "";
	return [
		present.length ? `当前在场：${present.join("、")}` : "",
		focus ? `当前焦点：${focus}` : "",
		background.length ? `背景角色：${background.join("、")}` : "",
		...advice.knowledgeBoundaries.slice(0, 12).map((item) => `知识边界：${item}`),
	].filter(Boolean).join("\n").slice(0, 1800);
}
