import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { DisplayRule } from "./cardfront.ts";
import { applyCardSkin } from "./cardSkin.ts";
import { prepareDisplayText } from "./postprocess.ts";
import { readJsonFile } from "./jsonio.ts";

export interface ValidatedStatus {
	raw: string;
	rendered: string;
	validatedAt: number;
}

/** 缺失状态栏时给旁路恢复 Agent 的提示；规则本身仍由代码执行和校验。 */
export function buildStatusRecoveryPrompt(input: {
	rules: unknown[];
	charName: string;
	userName: string;
	state: string;
	mvu: string;
	userText: string;
	narrative: string;
	previous?: string;
	error?: string;
}): { systemPrompt: string; userText: string } {
	return {
		systemPrompt: `你是角色卡状态栏恢复 Agent。只输出完整的状态栏原文，不要输出解释、Markdown 围栏、正文或 JSON。必须尽量复用上一份有效状态栏的结构，并根据本轮明确发生的事实更新字段。角色卡显示规则由程序最终校验，不要自行改变标签、字段顺序或包裹结构。角色名：${input.charName}；用户名：${input.userName}。${input.error ? `上次输出被程序拒绝，必须修复：${input.error}` : ""}显示规则摘要：${JSON.stringify(input.rules).slice(0, 12000)}`,
		userText: `【上一份有效状态栏】\n${input.previous || "（无）"}\n\n【当前世界账本】\n${input.state}\n\n【当前 MVU】\n${input.mvu}\n\n【本轮用户输入】\n${input.userText}\n\n【本轮正文】\n${input.narrative}`,
	};
}

export function validateStatusSubmission(
	raw: string,
	skin: { rules: DisplayRule[]; charName: string; userName: string },
): { ok: true; status: ValidatedStatus } | { ok: false; errors: string[] } {
	const text = raw.trim();
	const errors: string[] = [];
	if (!text) return { ok: false, errors: ["状态栏为空"] };
	const rendered = prepareDisplayText(text, skin);
	const directlySkinned = applyCardSkin(text, skin.rules, skin);
	const changed = directlySkinned !== text;
	const completeHtml = /<style[\s>][\s\S]*<\/style>/i.test(rendered) && /<(?:div|section|article)\b[\s\S]*<\/(?:div|section|article)>/i.test(rendered);
	const completeTag = /<(?:StatusBlock|status_block|status|statusbar)\b[^>]*>[\s\S]*<\/(?:StatusBlock|status_block|status|statusbar)>/i.test(text);
	if (skin.rules.length && !changed) errors.push("角色卡显示正则没有命中，请严格照角色卡规定的标签、字段顺序和标点重写状态栏");
	if (!completeHtml && !completeTag) errors.push("状态栏结构不完整：缺少完整开闭标签，或未生成闭合的 HTML 容器");
	if (/```html[\s\S]*<(?:div|section|article)\b(?![\s\S]*```)/i.test(text)) errors.push("HTML 围栏未闭合");
	if (errors.length) return { ok: false, errors };
	return { ok: true, status: { raw: text, rendered, validatedAt: Date.now() } };
}

export function loadValidatedStatus(file: string): ValidatedStatus | null {
	try {
		const value = readJsonFile(file) as Partial<ValidatedStatus>;
		return typeof value.raw === "string" && typeof value.rendered === "string"
			? { raw: value.raw, rendered: value.rendered, validatedAt: Number(value.validatedAt) || 0 }
			: null;
	} catch { return null; }
}

export function saveValidatedStatus(file: string, status: ValidatedStatus): void {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, JSON.stringify(status, null, 2), "utf8");
}
