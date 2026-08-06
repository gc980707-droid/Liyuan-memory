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
