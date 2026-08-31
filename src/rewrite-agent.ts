/** Contract and validation for the optional semantic rewrite agent. */

export interface RewriteAgentPatch {
	old: string;
	new: string;
	reason: string;
	rule: string;
	confidence: number;
}

export interface RewriteAgentReview {
	meaning: number;
	voice: number;
	continuity: number;
}

export interface RewriteAgentResponse {
	patches: RewriteAgentPatch[];
	review: RewriteAgentReview;
}

export interface RewriteValidation {
	ok: boolean;
	text: string;
	accepted: RewriteAgentPatch[];
	rejected: string[];
}

const number01 = (v: unknown): number => typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : -1;

/** Extracts the first JSON object, tolerating a markdown fence or short preamble. */
export function parseRewriteAgentResponse(raw: string): RewriteAgentResponse | null {
	const match = /\{[\s\S]*\}/.exec(raw);
	if (!match) return null;
	try {
		const value = JSON.parse(match[0]) as Record<string, unknown>;
		const review = value.review && typeof value.review === "object" ? value.review as Record<string, unknown> : {};
		const patches = Array.isArray(value.patches) ? value.patches : [];
		return {
			patches: patches.flatMap((p) => {
				if (!p || typeof p !== "object") return [];
				const x = p as Record<string, unknown>;
				if (typeof x.old !== "string" || typeof x.new !== "string") return [];
				return [{ old: x.old, new: x.new, reason: typeof x.reason === "string" ? x.reason : "", rule: typeof x.rule === "string" ? x.rule : "", confidence: number01(x.confidence) }];
			}),
			review: { meaning: number01(review.meaning), voice: number01(review.voice), continuity: number01(review.continuity) },
		};
	} catch { return null; }
}

export function buildRewriteAgentPrompt(input: { text: string; rulesSummary: string; protectedRanges?: string }): { systemPrompt: string; userText: string } {
	return {
		systemPrompt: "你是梨园的语义去八股审校 agent。只审校普通叙事，不改写事实，不新增动作、对白、人物、时间、视角或情节。必须只返回 JSON，不要 Markdown。",
		userText: JSON.stringify({
			task: "找出确实僵硬或模板化的句子，提交最少量 old→new 局部补丁；没有必要修改就返回空 patches。",
			text: input.text,
			rules: input.rulesSummary,
			protectedRanges: input.protectedRanges ?? "状态栏、思考链、HTML、代码块、用户消息均不可触碰",
			output: { patches: [{ old: "原文连续片段", new: "替换片段", reason: "理由", rule: "触发规则", confidence: 0.0 }], review: { meaning: 0.0, voice: 0.0, continuity: 0.0 } },
			limits: "patches 最多 8 个；每个 old 必须来自原文且唯一；new 不得引入新事实；三项 review 和 confidence 都需达到 0.8 才会采用。",
		}, null, 2),
	};
}

function protectedContent(text: string): string[] {
	return [...text.matchAll(/```[\s\S]*?```|<(?:think|thinking|StatusPlaceHolderImpl)\b[\s\S]*?<\/(?:think|thinking|StatusPlaceHolderImpl)\s*>|<StatusPlaceHolderImpl\s*\/?\s*>/gi)].map((m) => m[0]);
}

/** Atomic validation: any failure rejects the whole candidate set. */
export function validateRewriteAgentResponse(original: string, response: RewriteAgentResponse | null): RewriteValidation {
	if (!response) return { ok: false, text: original, accepted: [], rejected: ["JSON 格式无效"] };
	if (response.patches.length > 8 || [response.review.meaning, response.review.voice, response.review.continuity].some((n) => n < 0.8)) {
		return { ok: false, text: original, accepted: [], rejected: ["复核评分未达到 0.8"] };
	}
	let text = original;
	const beforeProtected = protectedContent(original);
	const rejected: string[] = [];
	for (const patch of response.patches) {
		if (!patch.old || patch.confidence < 0.8) { rejected.push("补丁置信度不足或 old 为空"); continue; }
		const count = text.split(patch.old).length - 1;
		if (count !== 1) { rejected.push(`old 必须唯一命中：${patch.old.slice(0, 30)}`); continue; }
		if (patch.new.length > Math.max(2000, patch.old.length * 4)) { rejected.push("替换片段过长"); continue; }
		text = text.replace(patch.old, patch.new);
	}
	if (rejected.length || JSON.stringify(beforeProtected) !== JSON.stringify(protectedContent(text))) return { ok: false, text: original, accepted: [], rejected: rejected.length ? rejected : ["保护区域发生变化"] };
	return { ok: true, text, accepted: response.patches, rejected: [] };
}
