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

export interface StatusBarCharacter {
	/** 角色名（账本规范名） */
	name: string;
	/** 头部行（如 『📅 日期：7月15日 | ⏰ 时间：14:30 | 📍 位置：1号软卧包厢』） */
	head: string;
	/** 结构化字段（保持原文顺序） */
	fields: StatusBarField[];
	/** 卡自带美化模板（皮肤）渲染的 HTML——有则前端 HtmlFrame 显示，无则默认面板 */
	html?: string;
}

export interface StatusBarSnapshot {
	/** 角色列表（前端下拉切换；至少一个） */
	characters: StatusBarCharacter[];
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

/** 从块内提取角色名：顶层无冒号 bullet（如 `- 苏小棉的状态`）去掉「的状态」尾巴；无则空 */
function guessCharName(inner: string): string {
	for (const line of inner.split(/\r?\n/)) {
		const t = line.trim();
		if (!t || /^\s/.test(line)) continue;
		const m = /^[-•*]\s*(.+)$/.exec(t);
		if (!m) continue;
		const item = m[1].trim();
		if (!/[:：]/.test(item)) return item.replace(/的\s*状态\s*$/, "").trim();
	}
	return "";
}

/**
 * 单块 → 结构化快照。
 * 解析是“行前缀”扫描（非正则美化）：头部取『…』整行；字段取 details 内的
 * `- 前缀：值` 行，嵌套子行（缩进的子 bullet / 多行）归并进上一个字段值。
 */
export function parseStatusBarBlock(block: string, charName?: string): StatusBarSnapshot {
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
	const name = charName || guessCharName(inner) || "角色";
	return { characters: [{ name, head, fields }], raw };
}

// ---------------- 彻底工具化：模板提取 + 账本渲染 ----------------
// 模型不再写状态栏格式块；harness 从卡里提取「状态栏模板」（开场示例），
// 每拍结束后用账本数据（time/location + status_fields）按模板骨架重建渲染。
// 渲染是确定性的行骨架重建（无正则美化、无替换脚本）。

export interface StatusBarTemplate {
	/** 卡内找到的状态栏示例块原文（字段值为示例占位） */
	raw: string;
	/** head 行（『…』或第一非空行）——渲染时按段替换日期/时间/位置 */
	head: string;
	/** 行骨架（渲染时逐行重建：static 原样，field 填账本值，缺则用卡示例值） */
	rows: Array<{ kind: "static" | "field"; text: string; indent: string; label: string; sample: string }>;
	/** 字段 label 清单（按出现顺序；提示词与账本 key 依据） */
	fieldLabels: string[];
}

/** 从卡内容文本里提取状态栏模板：找第一个完整 <Status_block> 块 → 行骨架 */
export function extractStatusBarTemplate(texts: string[]): StatusBarTemplate | null {
	let block: string | null = null;
	for (const t of texts) {
		if (!t) continue;
		const { blocks } = extractStatusBarBlocks(t);
		if (blocks.length > 0) {
			block = blocks[0];
			break;
		}
	}
	if (!block) return null;
	const inner = block.replace(OPEN_RE, "").replace(CLOSE_RE, "").trim();
	const headMatch = /『[^』\n]+(?:』|$)/.exec(inner);
	const rows: Array<{ kind: "static" | "field"; text: string; indent: string; label: string; sample: string }> = [];
	let minFieldIndent = -1;
	for (const line of inner.split(/\r?\n/)) {
		const indent = /^(\s*)/.exec(line)?.[1] ?? "";
		const t = line.trim();
		if (!t) continue;
		const bullet = /^[-•*]\s*(.+)$/.exec(t);
		if (bullet) {
			const item = bullet[1].trim();
			const kv = /^(.+?)(?::|：)\s*([\s\S]*)$/.exec(item);
			if (kv && kv[1].trim()) {
				const label = kv[1].trim();
				rows.push({ kind: "field", text: line, indent, label, sample: kv[2].trim() });
				if (minFieldIndent < 0 || indent.length < minFieldIndent) minFieldIndent = indent.length;
				continue;
			}
		}
		rows.push({ kind: "static", text: line, indent, label: "", sample: "" });
	}
	// 字段清单只含最浅缩进层级（顶层字段；子结构如 ⏱️ 时间/推文/评论名不单独列）
	const fieldLabels = rows
		.filter((r) => r.kind === "field" && r.indent.length === minFieldIndent)
		.map((r) => r.label);
	return {
		raw: block,
		head: headMatch ? headMatch[0].trim() : rows.find((r) => r.kind === "static")?.text.trim() ?? "",
		rows,
		fieldLabels,
	};
}

/** 值查找：宽松匹配（段 label 常带 emoji 前缀，账本 key 可能只写「日期」——双向包含）；「未提及」视为无 */
export function matchSlotValue(values: Record<string, string>, label: string): string | undefined {
	const direct = values[label];
	if (direct && direct !== "未提及") return direct;
	for (const k of Object.keys(values)) {
		const v = values[k];
		if (v && v !== "未提及" && (label.includes(k) || k.includes(label))) return v;
	}
	return undefined;
}

/** head 行的段替换：『📅 日期：X | ⏰ 时间：Y | 📍 位置：Z』按 | 分段，段内「label：值」用账本值替换 */
export function renderStatusBarHead(head: string, values: Record<string, string>): string {
	const parts = head.split("|").map((seg) => {
		const s = seg.trim();
		const ci = s.indexOf("：");
		const ci2 = s.indexOf(":");
		const idx = ci < 0 ? ci2 : ci2 < 0 ? ci : Math.min(ci, ci2);
		if (idx <= 0) return s;
		const label = s.slice(0, idx).trim();
		const oldValue = s.slice(idx + 1);
		const v = matchSlotValue(values, label);
		if (v) {
			// 只替换值本体，保留段尾闭合符号（』」」等）
			const suffix = (oldValue.match(/[』」」\]]+$/) ?? [""])[0];
			return `${s.slice(0, idx + 1)}${v}${suffix}`;
		}
		return s;
	});
	return parts.join(" | ");
}

/**
 * 值槽序（皮肤模板填充用）：head 段值（按 head 模板段序）→ 顶层字段值
 * （账本 > 卡示例 > 空）。与卡美化脚本的捕获组串联序对应。
 */
export function buildStatusBarValueSlots(
	template: StatusBarTemplate,
	state: { time?: string; location?: string },
	charFields?: Record<string, string>,
): string[] {
	const values: Record<string, string> = { ...(charFields ?? {}) };
	if (state.time && !values["时间"]) values["时间"] = state.time;
	if (state.location && !values["位置"]) values["位置"] = state.location;
	const slots: string[] = [];
	for (const seg of template.head.split("|")) {
		const s = seg.trim();
		const ci = s.indexOf("：");
		const ci2 = s.indexOf(":");
		const idx = ci < 0 ? ci2 : ci2 < 0 ? ci : Math.min(ci, ci2);
		if (idx <= 0) continue;
		slots.push(matchSlotValue(values, s.slice(0, idx).trim()) ?? "");
	}
	for (const label of template.fieldLabels) {
		const v = values[label];
		const effective = v && v !== "未提及" ? v : template.rows.find((r) => r.kind === "field" && r.label === label)?.sample;
		slots.push(effective ?? "");
	}
	return slots;
}

/**
 * 账本 → 某角色的状态栏块文本：按模板行骨架重建。
 * - charFields：该角色 status_fields（label → 值）
 * - head：renderStatusBarHead 段替换（日期/时间/位置等查该角色字段 + 全局 time/location）
 * - field 行：value = charFields[label]；无值整行跳过（不露空行）
 * - static 行（details/summary 骨架等）：原样
 */
export function renderStatusBarFromState(
	template: StatusBarTemplate,
	state: { time?: string; location?: string },
	charFields?: Record<string, string>,
): string {
	const values: Record<string, string> = { ...(charFields ?? {}) };
	if (state.time && !values["时间"]) values["时间"] = state.time;
	if (state.location && !values["位置"]) values["位置"] = state.location;
	const head = renderStatusBarHead(template.head, values);
	const lines: string[] = [];
	for (const row of template.rows) {
		if (row.kind === "field") {
			// 取值优先级：账本 > 卡模板示例值（静态字段如账号/粉丝数继承卡设定）> 跳过。
			// 「未提及」视为无值（场记推断不出时省略，不写死占位）。
			const v = values[row.label];
			const effective = v && v !== "未提及" ? v : row.sample;
			if (!effective) continue;
			lines.push(`${row.indent}- ${row.label}：${effective}`);
		} else {
			lines.push(row.text);
		}
	}
	return `<Status_block>\n${head}\n${lines.join("\n")}\n</Status_block>`;
}

// ---------------- 卡自带美化模板（皮肤）：导入时抓取，harness 填充 ----------------
// 角色卡的美化正则脚本 = 作者手写的 HTML/CSS 模板（replaceString）+ 匹配机制（findRegex）。
// harness 已经自己生成内容，不需要匹配机制——导入时把模板链抓出来，
// 渲染时用结构化字段按捕获组序填充（模板填充，非正则替换）。每张卡的状态栏都是它自己的设计。

export interface StatusBarSkinScript {
	/** 作者写的 HTML 模板（原 replaceString） */
	template: string;
	/** 该模板的捕获组数（组序 = 状态栏内容书写序，用于 $1..$n 填充） */
	groupCount: number;
	/**
	 * 组 → 值槽映射（导入时用卡示例块学习；-1 = 该组在示例块中未捕获/未匹配）。
	 * 卡作者正则常做细粒度捕获（昵称/账号/数值单独抓），组序≠字段序——学习后按映射取槽。
	 */
	mapping: number[];
}

export interface StatusBarSkin {
	scripts: StatusBarSkinScript[];
	/** 状态栏内容值槽序（head 段值 → 字段值），与所有脚本的组序串联对应 */
	valueSlots: string[];
}

/** 解析正则字符串的捕获组数（跳过转义、字符类、非捕获组）；解析失败返回 -1 */
export function parseGroupCount(findRegex: string): number {
	const s = findRegex.trim();
	// 剥掉 /pattern/flags 外壳
	let body = s;
	const shell = /^\/([\s\S]*)\/[a-z]*$/.exec(s);
	if (shell) body = shell[1];
	let count = 0;
	let i = 0;
	while (i < body.length) {
		const ch = body[i];
		if (ch === "\\") {
			i += 2;
			continue;
		}
		if (ch === "[") {
			// 字符类内跳过（含 ] 转义）
			i++;
			while (i < body.length && body[i] !== "]") {
				if (body[i] === "\\") i++;
				i++;
			}
			i++;
			continue;
		}
		if (ch === "(") {
			const rest = body.slice(i + 1);
			// 非捕获组 / 断言 / 具名组判别
			if (rest.startsWith("?:")) {
				// 非捕获
			} else if (rest.startsWith("?=") || rest.startsWith("?!") || rest.startsWith("?<=") || rest.startsWith("?<!")) {
				// 断言
			} else if (rest.startsWith("?<")) {
				// 具名捕获组 (?<name>...
				count++;
			} else {
				count++;
			}
		}
		i++;
	}
	return count;
}

/**
 * 从卡 regex_scripts 抓状态栏美化模板链：
 * - 筛出「状态栏相关」脚本（scriptName 或内容提到 状态栏/status/Status_block），
 *   且至少一个脚本的模板是 HTML（<style> / <div / <article 等）——避免误抓普通 status 脚本
 * - 保持卡内脚本原顺序（链式：容器头 → 内容 → 配图 → 容器尾）
 * - sampleText 给卡状态栏示例块时：逐脚本学习「组 → 字段值槽」映射（跑一次 findRegex，
 *   组值与示例字段值匹配）——卡作者正则常做细粒度捕获，组序≠字段序。
 */
export function extractStatusBarSkin(
	raw: Record<string, unknown> | null | undefined,
	sampleText?: string,
	sampleFieldValues?: string[],
): StatusBarSkin | null {
	if (!raw || typeof raw !== "object") return null;
	const data = raw.data && typeof raw.data === "object" ? (raw.data as Record<string, unknown>) : raw;
	const ext = data.extensions && typeof data.extensions === "object" ? (data.extensions as Record<string, unknown>) : {};
	const scripts = Array.isArray(ext.regex_scripts) ? ext.regex_scripts : [];
	const picked: StatusBarSkinScript[] = [];
	let sawStatusBlock = false;
	for (const s of scripts) {
		if (!s || typeof s !== "object") continue;
		const r = s as Record<string, unknown>;
		const name = typeof r.scriptName === "string" ? r.scriptName : "";
		const find = typeof r.findRegex === "string" ? r.findRegex : "";
		const replace = typeof r.replaceString === "string" ? r.replaceString : "";
		const isStatus = /状态栏|status|Status_?block/i.test(name + "\n" + find + "\n" + replace.slice(0, 300));
		if (!isStatus) continue;
		if (/Status_?block/i.test(name + "\n" + find + "\n" + replace)) sawStatusBlock = true;
		// 只收 HTML 模板（美化脚本的 replaceString 是界面；纯文本替换不是皮肤）。
		// 闭合类模板（如 </div> 容器尾）以闭合标签开头也算。
		if (
			!/<\s*(?:style|div|article|section|span|aside|main|table|img|a|p|h[1-6])[\s>]/i.test(replace) &&
			!/^\s*<\/(?:div|article|section|aside|main|table|span)\s*>/.test(replace)
		)
			continue;
		const groupCount = parseGroupCount(find);
		if (groupCount < 0) continue;
		// 学习映射：跑一次 findRegex 于示例块，组值 ↔ 示例字段值匹配
		const mapping: number[] = new Array(groupCount).fill(-1);
		if (sampleText && sampleFieldValues && sampleFieldValues.length > 0 && groupCount > 0) {
			try {
				const body = /^\/([\s\S]*)\/[a-z]*$/.exec(find.trim());
				const re = new RegExp(body ? body[1] : find.trim(), "s");
				const m = re.exec(sampleText);
				if (m) {
					for (let g = 1; g <= groupCount; g++) {
						const gv = (m[g] ?? "").trim();
						if (!gv) continue;
						// 精确相等优先，其次包含关系
						const exact = sampleFieldValues.findIndex((fv) => fv === gv);
						if (exact >= 0) {
							mapping[g - 1] = exact;
							continue;
						}
						const idx = sampleFieldValues.findIndex((fv) => fv && (fv.includes(gv) || gv.includes(fv)));
						if (idx >= 0) mapping[g - 1] = idx;
					}
				}
			} catch {
				/* 学习失败：退化为顺序填充（组序=字段序假设） */
			}
		}
		picked.push({ template: replace, groupCount, mapping });
	}
	if (picked.length === 0 || !sawStatusBlock) return null;
	return { scripts: picked, valueSlots: [] };
}

/** HTML 转义（模板填充防注入） */
export function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/**
 * 模板填充：把模板里的 $1..$n 替换为 values 对应槽位（$n ← values[n-1]）。
 * 手动扫描实现（不用替换类正则——渲染机制不依赖正则脚本）。
 */
export function fillTemplate(template: string, values: string[]): string {
	let out = "";
	let i = 0;
	while (i < template.length) {
		const ch = template[i];
		if (ch === "$") {
			let j = i + 1;
			let num = "";
			while (j < template.length && /[0-9]/.test(template[j])) {
				num += template[j];
				j++;
			}
			if (num) {
				const idx = Number(num) - 1;
				out += idx >= 0 && idx < values.length ? values[idx] : "";
				i = j;
				continue;
			}
		}
		out += ch;
		i++;
	}
	return out;
}

/**
 * 渲染状态栏 HTML（卡皮肤模板链填充）。
 * valueSlots 已按 head 段值 + 字段值（账本优先、卡示例兜底）铺好；
 * 各脚本模板按序取槽位填充后拼接（链式脚本的最终产物 ≈ 模板依次拼接）。
 * 有学习映射时按映射取槽（细粒度捕获对齐）；无映射退化为顺序填充。
 * 填充值一律 HTML 转义（防注入、防样式破坏）。
 */
export function renderStatusBarHtml(skin: StatusBarSkin, valueSlots: string[]): string {
	let cursor = 0;
	const parts: string[] = [];
	for (const script of skin.scripts) {
		const mapped = script.mapping.some((x) => x >= 0);
		const slotValues = new Array(script.groupCount).fill("");
		for (let g = 0; g < script.groupCount; g++) {
			const slotIdx = mapped ? script.mapping[g] : cursor + g;
			if (slotIdx >= 0 && slotIdx < valueSlots.length) {
				slotValues[g] = valueSlots[slotIdx];
			}
		}
		cursor += script.groupCount;
		parts.push(fillTemplate(script.template, slotValues.map(escapeHtml)));
	}
	let out = parts.join("");
	// 配图占位符残渣（无配图数据时链式模板未消费）：整段清理，不露文本
	out = out.replace(/§§IMG_START§§[\s\S]*?§§IMG_END§§/g, "");
	// 空的无图说明标签（无图模板填了空值）：删掉
	out = out.replace(/<div class="[^"]*nofig[^"]*">\s*<\/div>/g, "");
	// 空 src 的 img（配图组未捕获到值）：删掉
	out = out.replace(/<img[^>]*src=""[^>]*>/g, "");
	return out;
}