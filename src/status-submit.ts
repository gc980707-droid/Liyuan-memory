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

/** 判断任意 XML/HTML 状态容器是否完整，不依赖某张卡的固定标签名。 */
export function hasCompleteStatusContainer(text: string): boolean {
	const source = normalizeStatusSubmission(text);
	if (/<style[\s>][\s\S]*<\/style>/i.test(source) && /<(?:div|section|article)\b[\s\S]*<\/(?:div|section|article)>/i.test(source)) return true;
	const tag = source.match(/^\s*<([A-Za-z_\u4e00-\u9fff][\w.\-\u4e00-\u9fff]*)\b[^>]*>/);
	if (!tag || !new RegExp(`<\\/${tag[1]}\\s*>\\s*$`, "i").test(source)) return false;
	const open = new RegExp(`<${tag[1]}\\b`, "gi");
	const close = new RegExp(`<\\/${tag[1]}\\s*>`, "gi");
	return [...source.matchAll(open)].length === [...source.matchAll(close)].length;
}

/** 去掉恢复 Agent 常见的代码围栏/解释前缀，但不改写状态正文。 */
export function normalizeStatusSubmission(raw: string): string {
	let text = raw.trim();
	// 模型偶尔会在状态块前加一句说明；从第一个标签开始截取。
	const firstTag = text.search(/<[A-Za-z_\u4e00-\u9fff]/);
	if (firstTag > 0) text = text.slice(firstTag).trim();
	const fenced = text.match(/^```(?:html|xml|text)?\s*([\s\S]*?)\s*```\s*$/i);
	if (fenced) text = fenced[1].trim();
	else text = text.replace(/\s*```\s*$/i, "").trim();
	return text;
}

/** 从主演原始输出中找回卡片状态块，旁路恢复模型无响应时使用。 */
export function extractStatusSubmission(text: string): string | null {
	const match = text.match(/<(StatusBlock|status_block|Status_block|statusblock|status|statusbar|normal_status|special_status|state\s*\d+)\b[^>]*>[\s\S]*?<\/\1\s*>/i);
	return match ? normalizeStatusSubmission(match[0]) : null;
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
	manifestStatus?: { required: boolean; formats: string[]; regexRuleCount: number };
}): { systemPrompt: string; userText: string } {
	return {
		systemPrompt: `你是独立状态 Agent。状态栏不依赖角色卡正则，直接根据当前世界账本和 MVU 变量生成最新状态。只输出一个完整的 <StatusBlock>...</StatusBlock>，不要输出解释、Markdown 围栏、正文或 JSON。状态栏只是当前状态的只读显示投影，不能发明账本没有的事实。角色名：${input.charName}；用户名：${input.userName}。${input.error ? `上次输出被程序拒绝，必须修复：${input.error}` : ""}`,
		userText: `【上一份有效状态栏】\n${input.previous || "（无）"}\n\n【当前世界账本】\n${input.state}\n\n【当前 MVU】\n${input.mvu}\n\n【本轮用户输入】\n${input.userText}\n\n【本轮正文】\n${input.narrative}`,
	};
}

function escapeHtml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function buildDeterministicStatusHtml(input: { state: string; mvu: string; charName: string }): string {
	return `<div class="liyuan-agent-status"><style>.liyuan-agent-status{font-family:system-ui,sans-serif;background:#111827;color:#e5e7eb;border:1px solid #374151;border-radius:12px;padding:12px;line-height:1.55}.liyuan-agent-status h3{margin:0 0 8px;font-size:15px}.liyuan-agent-status pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;font:inherit}</style><h3>${escapeHtml(input.charName)} · 当前状态</h3><pre>${escapeHtml(`${input.state}\n\n${input.mvu}`)}</pre></div>`;
}

export function validateStatusSubmission(
	raw: string,
	skin: { rules: DisplayRule[]; charName: string; userName: string },
	options?: { agentControlled?: boolean },
): { ok: true; status: ValidatedStatus } | { ok: false; errors: string[] } {
	const text = normalizeStatusSubmission(raw);
	const errors: string[] = [];
	if (!text) return { ok: false, errors: ["状态栏为空"] };
	const rendered = options?.agentControlled ? text : prepareDisplayText(text, skin);
	const directlySkinned = options?.agentControlled ? text : applyCardSkin(text, skin.rules, skin);
	const changed = directlySkinned !== text;
	const completeHtml = hasCompleteStatusContainer(rendered);
	const completeTag = hasCompleteStatusContainer(text);
	if (!options?.agentControlled && skin.rules.length && !changed) errors.push("角色卡显示正则没有命中，请严格照角色卡规定的标签、字段顺序和标点重写状态栏");
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
