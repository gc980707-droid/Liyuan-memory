export interface PreflightAdvice {
	focus: string;
	characterIntents: string[];
	constraints: string[];	avoid: string[];
}

const empty = (): PreflightAdvice => ({ focus: "", characterIntents: [], constraints: [], avoid: [] });

export function parsePreflightAdvice(text: string | null | undefined): PreflightAdvice | null {
	if (!text?.trim()) return null;
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start >= 0 && end > start) {
		try {
			const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
			const result = empty();
			result.focus = typeof raw.focus === "string" ? raw.focus : typeof raw.recommended_focus === "string" ? raw.recommended_focus : "";
			result.characterIntents = Array.isArray(raw.characterIntents) ? raw.characterIntents.filter((x): x is string => typeof x === "string") : Array.isArray(raw.character_intents) ? raw.character_intents.filter((x): x is string => typeof x === "string") : [];
			result.constraints = Array.isArray(raw.constraints) ? raw.constraints.filter((x): x is string => typeof x === "string") : [];
			result.avoid = Array.isArray(raw.avoid) ? raw.avoid.filter((x): x is string => typeof x === "string") : [];
			return result;
		} catch { /* fall through to safe text */ }
	}
	return { ...empty(), focus: text.trim().slice(0, 240) };
}

export function formatPreflightAdvice(advice: PreflightAdvice): string {
	const lines = [advice.focus && `重点：${advice.focus}`, ...advice.characterIntents.map((x) => `角色意图：${x}`), ...advice.constraints.map((x) => `约束：${x}`), ...advice.avoid.map((x) => `避免：${x}`)].filter(Boolean);
	return lines.join("\n").slice(0, 2400);
}

export function hardenPreflightAdvice(advice: PreflightAdvice, stateText: string): PreflightAdvice {
	const constraints = [...advice.constraints];
	if (stateText.trim()) constraints.unshift(`硬约束：当前世界状态优先，不得擅自修改时间、地点、角色、物品或已确认事实；只有正文明确经过时间/地点推进后才可更新。当前状态：${stateText.slice(0, 900)}`);
	return { ...advice, constraints: [...new Set(constraints)].slice(0, 12) };
}
