/**
 * 状态栏工具管道（harness 层，非正则脚本）：
 *
 * 模型按卡格式在每拍末尾输出 `<Status_block>…</Status_block>` 原文；
 * harness 负责三件事：
 *   1) 从正文剥离状态栏块 —— 正文只留叙事，状态栏不再出现在故事流里
 *   2) 解析成结构化快照 —— 左栏“当前状态”面板的数据源
 *   3) 只保留最新一份 —— 前端渲染最新快照，跟随现时状态
 *
 * 兼容标签拼写（卡作者常见变体）：StatusBlock / Status_block / status_block。
 * 无合法闭合的残块不剥离，原样留给显示层兜底（不吞正文）。
 */

export interface StatusBarField {
	/** 字段前缀（含 emoji，如 📝 当前行动） */
	label: string;
	/** 字段值（多行归并） */
	value: string;
}

export interface StatusBarSnapshot {
	/** 头部行（如 『📅 日期：7月15日 | ⏰ 时间：14:30 | 📍 位置：1号软卧包厢』） */
	head: string;
	/** 结构化字段（保持原文顺序） */
	fields: StatusBarField[];
	/** 原始块全文（调试 / 兜底渲染） */
	raw: string;
}

/** 状态栏开标签（单次匹配：test / replace 用；无 g，不移动 lastIndex） */
const OPEN_RE = /<Status_?Block\b[^>]*>/i;
/** 状态栏开标签（扫描用；g flag，lastIndex 驱动，必须配合手动复位） */
const OPEN_SCAN_RE = /<Status_?Block\b[^>]*>/gi;
const CLOSE_RE = /<\/Status_?Block\s*>/i;

/** 块内细节区：<details>…</details>（可有可无；无则整块归头部与正文） */
const DETAILS_SAVE_RE = /<details>([\s\S]*?)<\/details>/i;
/** summary 行剔除 */
const SUMMARY_RE = /<summary>[\s\S]*?<\/summary>/g;

/** 是否自闭合占位符（<StatusBlock/> —— 界面由卡渲染，模型只留占位） */
function isSelfClosingOpen(tag: string): boolean {
	return /\/\s*>$/.test(tag);
}

/** 是否卡作者可能在正文里以纯文本提及（不带尖括号的情况不在此范围） */
export function hasStatusBarBlock(text: string): boolean {
	return OPEN_RE.test(text) && CLOSE_RE.test(text);
}

/**
 * 成对状态栏块扫描：返回 { cleaned, blocks }。
 * - 只有「开标签…闭标签」完整成对的块才剥离
 * - 无闭合的残块原样保留（不吞后续正文）
 */
export function extractStatusBarBlocks(text: string): { cleaned: string; blocks: string[] } {
	if (!text) return { cleaned: text, blocks: [] };
	const blocks: string[] = [];
	let out = "";
	let cursor = 0;
	OPEN_SCAN_RE.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = OPEN_SCAN_RE.exec(text)) !== null) {
		const openStart = m.index;
		const openEnd = m.index + m[0].length;
		if (isSelfClosingOpen(m[0])) {
			cursor = Math.max(cursor, openEnd);
			continue;
		}
		const rest = text.slice(openEnd);
		CLOSE_RE.lastIndex = 0;
		const closeM = CLOSE_RE.exec(rest);
		if (!closeM) {
			// 无闭合：不再剥离（安全优先），继续往后找别的成对块
			OPEN_SCAN_RE.lastIndex = openEnd;
			continue;
		}
		const blockEnd = openEnd + closeM.index + closeM[0].length;
		if (openStart > cursor) out += text.slice(cursor, openStart);
		blocks.push(text.slice(openStart, blockEnd));
		cursor = blockEnd;
		OPEN_SCAN_RE.lastIndex = blockEnd;
	}
	if (cursor < text.length) out += text.slice(cursor);
	// 收敛剥离块留下的空白缝隙
	out = out
		.replace(/\n{3,}/g, "\n\n")
		.replace(/^\s*\n/gm, "\n")
		.trim();
	return { cleaned: out, blocks };
}

/** 正文剥离入口：状态栏块从正文中消失（正文只留叙事） */
export function stripStatusBarText(text: string): string {
	return extractStatusBarBlocks(text).cleaned;
}

/** 取最新快照（最后一个块）；无块返回 null */
export function latestStatusBarSnapshot(text: string): StatusBarSnapshot | null {
	if (!text) return null;
	const { blocks } = extractStatusBarBlocks(text);
	if (blocks.length === 0) return null;
	return parseStatusBarBlock(blocks[blocks.length - 1]);
}

/**
 * 单块 → 结构化快照。
 * 解析是“行前缀”扫描（非正则美化）：头部取『…』整行；字段取 details 内的
 * `- 前缀：值` 行，嵌套子行（缩进的子 bullet / 多行）归并进上一个字段值。
 */
export function parseStatusBarBlock(block: string): StatusBarSnapshot {
	const inner = block
		.replace(OPEN_RE, "")
		.replace(CLOSE_RE, "")
		.trim();
	// 头部：『…』整行优先（卡常见）；取不到则回落第一非空行（不含标签行）
	const headMatch = /『[^』\n]+(?:』|$)/.exec(inner);
	let head = headMatch ? headMatch[0].trim() : "";
	if (!head) {
		const first = inner
			.split(/\r?\n/)
			.map((l) => l.trim())
			.find((l) => l && !/^<details>|^<summary>|^<\/?Status_?Block/i.test(l));
		head = first ?? "";
	}
	const raw = block.trim();

	// 细节区：<details> 内容（无则整体当字段区）
	const details = DETAILS_SAVE_RE.exec(inner)?.[1] ?? inner;
	const body = details.replace(SUMMARY_RE, "").trim();

	const fields: StatusBarField[] = [];
	let current: StatusBarField | null = null;
	for (const line of body.split(/\r?\n/)) {
		const t = line.trim();
		if (!t) continue;
		const indentM = /^(\s*)[-•*]\s*(.+)$/.exec(line);
		if (indentM) {
			const item = indentM[2].trim();
			const kv = /^(.+?)(?::|：)\s*([\s\S]*)$/.exec(item);
			if (kv && kv[1].trim()) {
				current = { label: kv[1].trim(), value: kv[2].trim() };
				fields.push(current);
				continue;
			}
			// 顶层 bullet 无冒号（如 `- 苏小棉的状态` 父标题）：也建字段，供子项归并
			current = { label: item, value: "" };
			fields.push(current);
			continue;
		}
		if (current) {
			current.value = (current.value ? `${current.value}\n${t}` : t).trim();
		}
	}
	// 去掉 value 为空的字段（- 🐦 推特日记： 这种纯标题行也是空值，保留 label 也行）
	return { head, fields, raw };
}