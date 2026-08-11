/**
 * 状态栏剥离（防御性工具管道）：
 *
 * 老卡/旧行为下模型可能按卡格式在正文里写 `<Status_block>…</Status_block>`
 * 原文——正文只留叙事，这类格式块在 wire 上屏前剥离，不进入故事流。
 * （状态栏生成/展示已按用户定调移除——数据走账本，展示不再单独维护。）
 *
 * 兼容标签拼写（卡作者常见变体）：StatusBlock / Status_block / status_block。
 * 无合法闭合的残块不剥离，原样留给显示层兜底（不吞正文）。
 */

/** 状态栏开标签（单次匹配：test / replace 用；无 g，不移动 lastIndex） */
const OPEN_RE = /<Status_?Block\b[^>]*>/i;
/** 状态栏开标签（扫描用；g flag，lastIndex 驱动，必须配合手动复位） */
const OPEN_SCAN_RE = /<Status_?Block\b[^>]*>/gi;
const CLOSE_RE = /<\/Status_?Block\s*>/i;

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

/** 自闭合占位符标签剥离（<StatusPlaceHolderImpl/> 等非 HTML 标准标签） */
const HTML_SELF_CLOSE = new Set([
	"br", "hr", "img", "input", "meta", "link", "wbr", "area", "base", "col", "embed", "source", "track",
]);
export function stripStatusPlaceholders(text: string): string {
	return text.replace(/<([A-Za-z_][\w.-]*)\s*\/\s*>/g, (m, tag: string) => {
		const t = tag.toLowerCase();
		if (HTML_SELF_CLOSE.has(t)) return m;
		if (["slot", "template", "component", "view"].includes(t)) return m;
		return "";
	});
}

/** 卡/正文的完整状态栏清理：成对块 + 自闭合占位符 + 文末纯文本状态栏段（导入时与上屏时共用） */
export function stripAllStatusBarArtifacts(text: string): string {
	if (!text) return text;
	return stripTrailingStatusBar(stripStatusPlaceholders(stripStatusBarText(text)));
}

/**
 * 文末纯文本状态栏段剥离：模型可能输出无标签的状态栏（`- 苏小棉的状态`、
 * `📅 日期：…`、`💬 评论：…` 等 emoji 键行），成对块/占位符正则抓不到。
 * 规则：从文末反复剥「段内含状态栏特征键」的独立段落（段落间空行分隔）。
 */
const STATUS_BAR_SEG_RE =
	/(📅 日期：|📱\s*@|📍 位置：|⏰ 时间：|粉丝数：|福利度：|推特日记：|💬 评论：|📝 推文|基础信息|核心数值)/;

export function stripTrailingStatusBar(text: string): string {
	let t = text.trim();
	for (;;) {
		const segs = t.split(/\n\s*\n/);
		if (segs.length < 2) {
			// 整段就是状态栏
			if (segs.length === 1 && STATUS_BAR_SEG_RE.test(segs[0]) && /(^-\s*\S+的状态|📅|📱|💬)/.test(segs[0])) return "";
			return t;
		}
		const last = segs[segs.length - 1].trim();
		// 末段含状态栏特征键且形态像状态栏（emoji 键 / 「X 的状态」/ 分隔线开头）
		if (
			STATUS_BAR_SEG_RE.test(last) &&
			(/^(-\s*\S+的状态|📱|📅|---)/m.test(last) || STATUS_BAR_SEG_RE.test(last.slice(0, 60)))
		) {
			segs.pop();
			t = segs.join("\n\n").trim();
			continue;
		}
		break;
	}
	return t;
}