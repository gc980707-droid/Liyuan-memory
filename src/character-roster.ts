import type { CharacterCard, LorebookEntry } from "./types.ts";

/** 从角色卡和世界书提取稳定的核心角色名，避免每轮调用无关 NPC。 */
export function coreCharacterNames(card: CharacterCard, lore: LorebookEntry[]): string[] {
	const names = new Set<string>();
	if (card.name.trim()) names.add(card.name.trim());
	for (const entry of lore) {
		const name = entry.comment.trim();
		if (!name || name.length > 40 || /状态|规则|文风|世界|设定|资料|profile|rule/i.test(name)) continue;
		if (entry.keys.length > 0 || entry.content.length > 100) names.add(name);
	}
	return [...names].slice(0, 8);
}
