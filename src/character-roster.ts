import type { CharacterCard, LorebookEntry } from "./types.ts";

/** 从角色卡和世界书提取稳定的核心角色名，避免每轮调用无关 NPC。 */
export function coreCharacterNames(card: CharacterCard, lore: LorebookEntry[], options?: { userName?: string; sceneText?: string }): string[] {
	const names = new Set<string>();
	const userName = options?.userName?.trim();
	const cardName = card.name.trim();
	if (cardName && cardName !== userName && !/[：:]/.test(cardName) && !/福利姬|角色卡|剧本|故事|录$/u.test(cardName)) names.add(cardName);
	for (const entry of lore) {
		const name = entry.comment.trim();
		if (!name || name === userName || name === "{{user}}" || name.length > 40 || /状态|规则|文风|世界|设定|资料|profile|rule/i.test(name)) continue;
		if (options?.sceneText && !options.sceneText.includes(name) && !entry.constant) continue;
		if (entry.keys.length > 0 || entry.content.length > 100) names.add(name);
	}
	return [...names].slice(0, 8);
}

/** Manifest 使用的角色来源：只从世界书条目标题读取，不把卡名误当成角色。 */
export function loreCharacterNames(lore: LorebookEntry[], userName?: string): string[] {
	const names = new Set<string>();
	const user = userName?.trim();
	for (const entry of lore) {
		const name = entry.comment.trim();
		// 世界书没有统一的角色字段：保留短标题作为候选，交给场景命中和
		// Manifest 的运行配置决定是否启用 Agent。不要按某种语言的词汇猜测
		// 「规则」「设定」等类别，否则会误伤其它卡的角色名。
		if (!name || name === user || /^\{\{(?:user|char|人格|用户)\}\}$/iu.test(name)) continue;
		if (name.length > 80 || /[\r\n]/.test(name)) continue;
		if (!entry.content.trim() && entry.keys.length === 0) continue;
		names.add(name);
	}
	return [...names].slice(0, 64);
}
