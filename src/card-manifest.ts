import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CharacterCard, LorebookEntry } from "./types.ts";
import { cardStatusBarFormats, extractRegexScripts } from "./cardfront.ts";
import type { MvuData } from "./mvu.ts";

export interface CardManifest {
	version: 1;
	cardId: string;
	cardPath: string;
	cardName: string;
	characters: Array<{ name: string; kind: "core" | "recurring" | "background"; agentEnabled: boolean }>;
	mvu: { initial: MvuData; detected: boolean };
	status: { required: boolean; formats: string[]; regexRuleCount: number };
	capabilities: { mvu: boolean; displayRegex: boolean; tavernHelper: boolean };
	createdAt: string;
	updatedAt: string;
}

export function cardManifestId(raw: unknown): string {
	return createHash("sha256").update(JSON.stringify(raw)).digest("hex").slice(0, 16);
}

export function buildCardManifest(input: { raw: Record<string, unknown>; card: CharacterCard; cardPath: string; lore: LorebookEntry[]; initialMvu?: MvuData; userName?: string }): CardManifest {
	const data = input.raw.data && typeof input.raw.data === "object" ? input.raw.data as Record<string, unknown> : input.raw;
	const ext = data.extensions && typeof data.extensions === "object" ? data.extensions as Record<string, unknown> : {};
	const helper = ext.tavern_helper && typeof ext.tavern_helper === "object";
	const now = new Date().toISOString();
	const names = new Set<string>();
	const userName = input.userName?.trim();
	const cardName = input.card.name.trim();
	if (cardName && cardName !== userName && !/{{user}}/i.test(cardName) && !/福利姬|角色卡|剧本|故事|录$/u.test(cardName)) names.add(cardName);
	for (const entry of input.lore) {
		if (entry.comment && entry.comment !== userName && entry.comment !== "{{user}}" && !/状态|规则|文风|世界|设定|资料|profile|rule/i.test(entry.comment)) names.add(entry.comment);
	}
	return {
		version: 1,
		cardId: cardManifestId(input.raw),
		cardPath: input.cardPath,
		cardName: input.card.name,
		characters: [...names].slice(0, 32).map((name, index) => ({ name, kind: index === 0 ? "core" : "background", agentEnabled: index === 0 })),
		mvu: { initial: input.initialMvu ?? {}, detected: !!input.initialMvu && Object.keys(input.initialMvu).length > 0 },
		status: { required: cardStatusBarFormats(input.raw).length > 0, formats: cardStatusBarFormats(input.raw), regexRuleCount: extractRegexScripts(input.raw).length },
		capabilities: { mvu: !!input.initialMvu && Object.keys(input.initialMvu).length > 0, displayRegex: extractRegexScripts(input.raw).length > 0, tavernHelper: helper },
		createdAt: now,
		updatedAt: now,
	};
}

export function saveCardManifest(file: string, manifest: CardManifest): void {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, JSON.stringify(manifest, null, 2), "utf8");
}
