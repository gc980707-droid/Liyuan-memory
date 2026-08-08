import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { CharacterCard, LorebookEntry } from "./types.ts";
import { cardStatusBarFormats, displayRules, extractRegexScripts } from "./cardfront.ts";
import type { MvuData } from "./mvu.ts";
import { readFileSync, existsSync } from "node:fs";
import { loreFingerprint, appendLorebookFileEntry } from "./lorebook.ts";
import { loreCharacterNames } from "./character-roster.ts";

export interface CardManifest {
	version: 1;
	cardId: string;
	cardPath: string;
	cardName: string;
	characters: Array<{
		name: string;
		kind: "core" | "recurring" | "background";
		agentEnabled: boolean;
		loreFingerprint?: string;
		loreFingerprints?: string[];
		aliases?: string[];
		promotedAt?: string;
	}>;
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
	const names = loreCharacterNames(input.lore, input.userName);
	return {
		version: 1,
		cardId: cardManifestId(input.raw),
		cardPath: input.cardPath,
		cardName: input.card.name,
		characters: names.slice(0, 32).map((name, index) => ({ name, kind: index === 0 ? "core" : "background", agentEnabled: index === 0 })),
		mvu: { initial: input.initialMvu ?? {}, detected: !!input.initialMvu && Object.keys(input.initialMvu).length > 0 },
		status: { required: cardStatusBarFormats(input.raw).length > 0, formats: cardStatusBarFormats(input.raw), regexRuleCount: displayRules(extractRegexScripts(input.raw)).length },
		capabilities: { mvu: !!input.initialMvu && Object.keys(input.initialMvu).length > 0, displayRegex: displayRules(extractRegexScripts(input.raw)).length > 0, tavernHelper: helper },
		createdAt: now,
		updatedAt: now,
	};
}

export function syncCardManifestCharacters(manifest: CardManifest, input: { card: CharacterCard; lore: LorebookEntry[]; userName?: string }): CardManifest {
	const names = loreCharacterNames(input.lore, input.userName);
	const previous = new Map(manifest.characters.map((character) => [character.name, character]));
	const fingerprints = new Map<string, string[]>();
	for (const entry of input.lore) {
		const name = entry.comment.trim();
		if (!names.includes(name) || !entry.content.trim()) continue;
		const list = fingerprints.get(name) ?? [];
		const fp = loreFingerprint(entry.content);
		if (!list.includes(fp)) list.push(fp);
		fingerprints.set(name, list);
	}
	const characters = names.map((name) => {
		const old = previous.get(name);
		const loreFingerprints = fingerprints.get(name) ?? [];
		return old
			? { ...old, loreFingerprints, ...(loreFingerprints[0] ? { loreFingerprint: loreFingerprints[0] } : {}) }
			: { name, kind: "background" as const, agentEnabled: false, loreFingerprints };
	});
	return { ...manifest, characters, updatedAt: new Date().toISOString() };
}

/** 合并同名角色的多条世界书档案，避免只取第一条导致设定丢失。 */
export function characterLoreProfiles(lore: LorebookEntry[], names: string[]): Record<string, string> {
	const wanted = new Set(names);
	const grouped = new Map<string, string[]>();
	for (const entry of lore) {
		const name = entry.comment.trim();
		if (!wanted.has(name) || !entry.content.trim()) continue;
		const list = grouped.get(name) ?? [];
		if (!list.includes(entry.content.trim())) list.push(entry.content.trim());
		grouped.set(name, list);
	}
	return Object.fromEntries([...grouped].map(([name, parts]) => [name, parts.join("\n\n").slice(0, 9000)]));
}

export function saveCardManifest(file: string, manifest: CardManifest): void {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, JSON.stringify(manifest, null, 2), "utf8");
}

/** Manifest 是运行配置，按角色卡路径隔离并持久化到项目目录。 */
export function cardManifestFile(cwd: string, cardPath: string): string {
	const id = resolve(cwd, cardPath).replace(/[^A-Za-z0-9._-]/g, "_");
	return join(cwd, "manifests", `${id}.json`);
}

export function promoteManifestCharacter(manifest: CardManifest, name: string, kind: "core" | "recurring" | "background"): CardManifest {
	const target = name.trim();
	if (!target || target === "{{user}}") throw new Error("无效的常驻角色名");
	const characters = [...manifest.characters];
	const existing = characters.find((character) => character.name === target);
	if (existing) {
		existing.kind = kind;
		existing.agentEnabled = kind !== "background";
		existing.promotedAt = new Date().toISOString();
	} else {
		characters.push({ name: target, kind, agentEnabled: kind !== "background", promotedAt: new Date().toISOString() });
	}
	return { ...manifest, characters, updatedAt: new Date().toISOString() };
}

export function manifestAgentCharacters(manifest: CardManifest, sceneText: string): string[] {
	return manifest.characters
		.filter((character) => character.agentEnabled && sceneText.includes(character.name))
		.map((character) => character.name);
}

export function loadCardManifest(file: string): CardManifest | null {
	if (!existsSync(file)) return null;
	try { return JSON.parse(readFileSync(file, "utf8")) as CardManifest; } catch { return null; }
}

export function manifestMatchesCard(manifest: CardManifest | null, raw: Record<string, unknown>, cardPath: string): manifest is CardManifest {
	return !!manifest && manifest.version === 1 && manifest.cardId === cardManifestId(raw) && manifest.cardPath === cardPath;
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
		characters: next.characters.map((character) => character.name === input.name.trim() ? {
			...character,
			loreFingerprint: loreFingerprint(entry.content),
			aliases: input.aliases?.map((alias) => alias.trim()).filter(Boolean),
		} : character),
	};
	saveCardManifest(manifestFile, withLink);
	return withLink;
}
