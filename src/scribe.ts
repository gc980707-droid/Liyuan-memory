/**
 * 场记（scribe）：旁侧廉价模型——每轮结束后从正文抽取世界状态补丁（纯函数，零 pi 依赖）。
 *
 * 设计：记账从主演手里拿走（D10：产出是数据不是文字）。
 * 连续性/代打等事后审查已移除（费 token 且用户反馈无用）。
 */

import type { WorldState } from "./types.ts";

export interface ScribePromptInput {
	/** 当前世界状态（JSON 序列化前的对象） */
	state: WorldState;
	/** 本轮用户输入文本 */
	userText: string;
	/** 本轮助手正文（最终叙事文本） */
	assistantText: string;
	/** 主要角色名（账本规范名提示） */
	charName: string;
	/** 用户角色名 */
	userName: string;
	/**
	 * @deprecated 已不再做先斩后奏检测；保留字段以免旧调用方报错，忽略。
	 */
	detectUnaskedTurn?: boolean;
}

export interface ScribeResult {
	/** 状态补丁（applyPatch 语义），无变化为 {} */
	patch: Record<string, unknown>;
	/** 恒为空：连续性审查已关闭 */
	warnings: string[];
	/** 恒为 null：先斩后奏审查已关闭 */
	unaskedTurn: string | null;
}

export function buildScribeTurnPrompt(input: ScribePromptInput): { systemPrompt: string; userText: string } {
	const { state, userText, assistantText, charName, userName } = input;
	const knownCharacters = Object.keys(state.characters);
	const nameGuide = knownCharacters.length
		? `名字必须使用账本中已有的写法（当前已有：${knownCharacters.join("、")}；用户角色「${userName}」）`
		: `用户角色写作「${userName}」`;

	const systemPrompt = `你是一场角色扮演的场记。阅读【当前账本】与【本轮对话】，只做一件事：输出 JSON，更新需要记账的持久变化。

输出唯一字段：
"patch"：从本轮对话中提取需要记账的持久变化。字段语义：
- "time" / "location"：字符串，整体替换。剧内时间推移（入夜、次日清晨、数日后）必须更新 time。
- "characters"：{ "名字": { "affinity"?, "status"?, "notes"? } }，按字段合并。affinity 为 -100..100 的对${userName}态度值，基于账本当前值小步调整（通常 ±1~10）。${nameGuide}；只有全新出场的人物才建新条目，键用正文中的人名——不要把作品/剧本标题（如「${charName}」这类非人名）当作角色。
- "inventory"：字符串数组，整体替换——只在物品归属变化时给出变化后的完整清单，条目注明归属（如「黄铜怀表（${userName}持有）」）。
- "flags"：键值对，按键合并（值为字符串）。
- "plot_threads"：字符串数组，整体替换——新增或了结剧情线时给出完整清单。
要点：否定性事件也要记账（赠礼被拒→物品仍在原主处；承诺被收回→记入 flags）；新的承诺、约定、伏笔进 plot_threads；没有变化的字段不要出现在 patch 中；完全无变化则 "patch" 为 {}。

只输出 JSON 对象，例如 {"patch":{...}} 或 {"patch":{}}。不要输出 warnings、不要输出其他文字。`;

	const user = `【当前账本】
${JSON.stringify(state, null, 2)}

【本轮对话】
${userName}：${userText}

${charName}：${assistantText}`;

	return { systemPrompt, userText: user };
}

/**
 * 宽容解析场记输出：剥代码围栏后，从头逐个候选尝试解析 JSON 对象
 * （模型常在最前写一句「以下是账本更新：」之类的前言——若前言里恰好有
 * 「{」，旧逻辑按首个 { 切分会从错位开始 → 整个解析失败。2026-08-03 实测）。
 * 解析失败返回 null（调用方静默跳过本轮）。
 */
export function parseScribeResult(text: string): ScribeResult | null {
	let t = text.trim();
	const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (fence) t = fence[1].trim();
	// 逐个「{」为起点试切：首个能完整解析出 patch 的对象即命中
	let idx = 0;
	while (true) {
		const start = t.indexOf("{", idx);
		if (start === -1) break;
		// 从候选起点向后找平衡的右括号（跳过字符串里的「}」）
		let depth = 0;
		let inStr = false;
		let esc = false;
		let end = -1;
		for (let i = start; i < t.length; i++) {
			const ch = t[i];
			if (inStr) {
				if (esc) esc = false;
				else if (ch === "\\") esc = true;
				else if (ch === '"') inStr = false;
				continue;
			}
			if (ch === '"') inStr = true;
			else if (ch === "{") depth++;
			else if (ch === "}") {
				depth--;
				if (depth === 0) {
					end = i;
					break;
				}
			}
		}
		if (end === -1) break;
		try {
			const obj = JSON.parse(t.slice(start, end + 1)) as Record<string, unknown>;
			if (obj && typeof obj === "object" && !Array.isArray(obj)) {
				const patch =
					obj.patch && typeof obj.patch === "object" && !Array.isArray(obj.patch)
						? (obj.patch as Record<string, unknown>)
						: {};
				// 审查字段一律丢弃（即使旧模型仍返回）
				return { patch, warnings: [], unaskedTurn: null };
			}
		} catch {
			// 本候选不成（前言里的孤 {），试下一个
		}
		idx = start + 1;
	}
	return null;
}

// ---------- 状态栏字段生成（8/10 工具化·一次生成；多角色支持） ----------

export interface StatusBarCompletionInput {
	/** 卡状态栏模板顶层字段清单 */
	fieldLabels: string[];
	/** 账本当前 status_fields（角色 → 字段KV；已有值保留） */
	current: Record<string, Record<string, string>>;
	/** 出场角色（账本 characters 键 + 主角/用户；生成这些角色的状态栏） */
	knownCharacters: string[];
	/** 本拍用户输入 */
	userText: string;
	/** 本拍定稿正文（角色卡角色的叙事） */
	assistantText: string;
	charName: string;
	userName: string;
}

export interface StatusBarCompletionResult {
	/** 角色 → 完整 status_fields（含已有值与更新值） */
	statusFields: Record<string, Record<string, string>>;
}

/**
 * 兜底生成 prompt（主演记账 + 场记补缺）：给字段清单 + 各角色已有值 + 本轮对话，
 * 让场记**只补缺失字段**（主演已记的值严格保留，不做推断修改——主演是现场目击者）。
 * 输出 {角色名: {字段: 值}} —— 角色名用账本规范写法。
 */
export function buildStatusBarCompletionPrompt(input: StatusBarCompletionInput): {
	systemPrompt: string;
	userText: string;
} {
	const { fieldLabels, current, knownCharacters, userText, assistantText, charName, userName } = input;
	const fields = fieldLabels.join("\n");
	const chars = knownCharacters.length ? knownCharacters.join("、") : `${charName}、${userName}`;
	const currentJson = JSON.stringify(current, null, 2);
	const systemPrompt = `你是角色扮演的场记。角色卡定义了状态栏，主演每拍会记账部分字段，你负责**补齐缺失的字段**。阅读【本轮对话】与【当前各角色状态】，输出 JSON：为**每个出场角色**补齐状态栏字段。

规则：
- 输出对象按角色分组：{"status_fields": {"角色名": {"字段": "值", ...}, ...}}
- 角色名用账本规范写法；本拍没有戏份的角色可以省略（保留在账本里）。
- **【已有值严格保留】**：当前状态里已存在的字段，照抄原值输出，不要改动、不要改写（主演记的值是最权威的现场记录）。
- **只补缺失字段**：当前状态里没有的字段，从正文推断补上；推断不出就省略（不写「未提及」）。
- 状态描述贴合本拍正文的具体细节，不编造正文里没有的重大事件。
- **角色归属必须严格**：正文是「${charName}」的叙事，用户输入是「${userName}」的话——各自的行动/内心/穿搭写进各自角色。

字段清单（每个角色都按这份填）：
${fields}

出场角色：${chars}

只输出 JSON 对象：{"status_fields": {...}}。不要输出任何其他文字。`;

	const user = `【当前各角色状态】（主演已记的字段请原样保留）
${currentJson}

【本轮对话】
${userName}（用户）：${userText}

${charName}：${assistantText}`;

	return { systemPrompt, userText: user };
}

/** 宽容解析生成输出：{status_fields:{角色:{字段:值}}}；解析失败返回 null */
export function parseStatusBarCompletion(text: string): StatusBarCompletionResult | null {
	let t = text.trim();
	const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (fence) t = fence[1].trim();
	const start = t.indexOf("{");
	const end = t.lastIndexOf("}");
	if (start === -1 || end <= start) return null;
	try {
		const obj = JSON.parse(t.slice(start, end + 1)) as Record<string, unknown>;
		const raw = obj.status_fields;
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
		const statusFields: Record<string, Record<string, string>> = {};
		for (const [char, v] of Object.entries(raw as Record<string, unknown>)) {
			if (!v || typeof v !== "object" || Array.isArray(v)) continue;
			const bucket: Record<string, string> = {};
			for (const [k, fv] of Object.entries(v as Record<string, unknown>)) {
				if (typeof fv === "string") bucket[k] = fv;
				else if (fv !== null && fv !== undefined) bucket[k] = String(fv);
			}
			if (Object.keys(bucket).length > 0) statusFields[char] = bucket;
		}
		return Object.keys(statusFields).length > 0 ? { statusFields } : null;
	} catch {
		return null;
	}
}

// ---------- 世界书中文别名（修复：专有名词中译后英文关键词地板失效） ----------

export interface AliasEntryInput {
	uid: number;
	keys: string[];
	comment: string;
	/** 正文摘录（截断后），供理解条目指代什么 */
	excerpt: string;
}

export function buildLoreAliasPrompt(
	entries: AliasEntryInput[],
	language: string,
): { systemPrompt: string; userText: string } {
	const systemPrompt = `你为角色扮演世界书条目生成${language}检索别名。这些别名用于在${language}叙事文本中做关键词匹配，因此要覆盖该事物在${language}叙事中最可能被写出的称呼：常见意译、音译、职称（每条目 2~5 个，单个别名 2~6 字为宜）。不要生成过于宽泛的词（如「建筑」「怪物」这类单独出现会误触发的通用词，除非条目本身就是该范畴）。
只输出 JSON 对象：{ "<uid>": ["别名1", "别名2", ...], ... }，不要输出任何其他文字。`;

	const userText = entries
		.map((e) => `uid=${e.uid} keys=[${e.keys.join(", ")}] 标题=${e.comment || "（无）"}\n摘要：${e.excerpt}`)
		.join("\n\n");

	return { systemPrompt, userText };
}

/** 解析别名输出：{ uid: string[] }；解析失败返回 null */
export function parseLoreAliases(text: string): Map<number, string[]> | null {
	let t = text.trim();
	const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (fence) t = fence[1].trim();
	const start = t.indexOf("{");
	const end = t.lastIndexOf("}");
	if (start === -1 || end <= start) return null;
	try {
		const obj = JSON.parse(t.slice(start, end + 1)) as Record<string, unknown>;
		const map = new Map<number, string[]>();
		for (const [k, v] of Object.entries(obj)) {
			const uid = Number(k);
			if (!Number.isFinite(uid) || !Array.isArray(v)) continue;
			const aliases = v.filter((a): a is string => typeof a === "string" && a.trim().length > 0).map((a) => a.trim());
			if (aliases.length) map.set(uid, aliases);
		}
		return map;
	} catch {
		return null;
	}
}

// ---------- 前情接力摘要（原 src/compaction.ts，2026-08-02 随 harness 重做移入） ----------

export interface RpSummaryPromptInput {
	/** 被裁早期剧情的对话原文（序列化后） */
	conversationText: string;
	/** 工具账本快照（辅助参考，可能滞后于正文） */
	stateSnapshot: string;
	/** 更早剧情的既有摘要（二次压缩时传入，合并进本次摘要） */
	previousSummary?: string;
	language: string;
	userName: string;
}

export interface RpSummaryPrompt {
	systemPrompt: string;
	userText: string;
}

export function buildRpSummaryPrompt(input: RpSummaryPromptInput): RpSummaryPrompt {
	const { conversationText, stateSnapshot, previousSummary, language, userName } = input;

	const systemPrompt = `你是一场长篇角色扮演的场记。你的任务是为即将从上下文中裁掉的早期剧情写一份接力摘要——它将成为主演模型唯一能看到的「前情」，后续剧情将基于「本摘要 + 保留的最近对话」继续演出。

用${language}输出，按以下结构：

## 前情提要
按时间顺序概述关键事件（谁做了什么、结果如何）。保留剧内时间刻度（如「第一天黄昏」「第三天清晨」）。

## 人物
每位出场人物：性格要点、说话习惯、对${userName}的称呼、与${userName}的关系温度及演变轨迹。

## 承诺与伏笔
逐条列出所有未兑现的约定、只被提过一次的线索、悬而未决的问题。这一节宁多勿漏——漏掉一条，后续剧情就永远丢失它。

## 事实账
物品归属（谁持有什么）、伤势与身体状态、重要数值、时间线（现在是剧内第几天）。

## 当前场景
剧内此刻：第几天、什么时段、什么地点、谁在场、正在进行什么动作。必须以对话记录中**最新**的场景为准——这是续演点，写成更早的场景会导致剧情倒退。

规则：只记录对话中实际发生的事；不虚构、不评论、不续写剧情；人名地名保持剧中写法。`;

	const parts: string[] = [`<conversation>\n${conversationText}\n</conversation>`];
	if (previousSummary) {
		parts.push(
			`<previous-summary>\n${previousSummary}\n</previous-summary>\n\n（上面是更早剧情的既有摘要：把它的内容合并进本次摘要，不要丢弃其中的承诺、伏笔与事实。）`,
		);
	}
	parts.push(`【工具账本快照】（辅助参考；记账可能滞后于正文，与对话记录冲突时以对话记录为准）\n${stateSnapshot}`);
	parts.push("请按系统指令输出接力摘要。");

	return { systemPrompt, userText: parts.join("\n\n") };
}
