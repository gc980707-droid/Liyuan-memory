import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CharacterCard, LorebookEntry } from "./types.ts";
import { cardStatusBarFormats, extractRegexScripts } from "./cardfront.ts";
import type { MvuData } from "./mvu.ts";
import { readFileSync, existsSync } from "node:fs";
import { loreFingerprint, appendLorebookFileEntry } from "./lorebook.ts";

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

export function promoteManifestCharacter(manifest: CardManifest, name: string, kind: "core" | "recurring" | "background"): CardManifest {
	const target = name.trim();
	if (!target || target === "{{user}}") throw new Error("无效的常驻角色名");
	const characters = [...manifest.characters];
	const existing = characters.find((character) => character.name === target);
	if (existing) {
		existing.kind = kind;
		existing.agentEnabled = kind !== "background";
	} else {
		characters.push({ name: target, kind, agentEnabled: kind !== "background" });
	}
	return { ...manifest, characters, updatedAt: new Date().toISOString() };
}

export function manifestAgentCharacters(manifest: CardManifest, sceneText: string): string[] {
	return manifest.characters
		.filter((character) => character.agentEnabled && (character.kind === "core" ? sceneText.includes(character.name) : sceneText.includes(character.name)))
		.map((character) => character.name);
}

export function loadCardManifest(file: string): CardManifest | null {
	if (!existsSync(file)) return null;
	try { return JSON.parse(readFileSync(file, "utf8")) as CardManifest; } catch { return null; }
}

export function addManifestCharacterToLore(
	manifest: CardManifest,
	manifestFile: string,
	bookFile: string,
	input: { name: string; description: string; aliases?: string[]; kind?: "core" | "recurring" | "background" },
): CardManifest {
	const entry = appendLorebookFileEntry(bookFile, {
		comment: input.name.trim(),
		keys: [input.name, ...(input.aliases ?? [])],
		content: input.description.trim(),
		constant: false,
	});
	if (!entry) throw new Error("角色档案内容为空或已存在");
	const next = promoteManifestCharacter(manifest, input.name, input.kind ?? "recurring");
	const withLink = {
		...next,
		characters: next.characters.map((character) => character.name === input.name.trim() ? { ...character, loreFingerprint: loreFingerprint(entry.content) } : character),
	};
	saveCardManifest(manifestFile, withLink);
	return withLink;
}
