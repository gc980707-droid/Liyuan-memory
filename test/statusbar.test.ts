import { test } from "node:test";
import assert from "node:assert/strict";
import {
	buildStatusBarValueSlots,
	escapeHtml,
	extractStatusBarBlocks,
	extractStatusBarSkin,
	extractStatusBarTemplate,
	fillTemplate,
	latestStatusBarSnapshot,
	parseGroupCount,
	parseStatusBarBlock,
	renderStatusBarFromState,
	renderStatusBarHead,
	renderStatusBarHtml,
	stripStatusBarText,
} from "../src/statusbar.ts";

const BLOCK = `<Status_block>
[HEAD line 1 | HEAD line 2]
<details><summary>[role status]</summary>
- state of A
  - [name]: A (nick)
  - [action]: doing things
  - [thought]: *thinking...*
  - [fans]: 285k
  - [diary]:
    - [time]: 2min ago
    - [tweet]: hello world
</details>
</Status_block>`;

test("strip: removes block keeps prose", () => {
	const text = `prose one.\n\n${BLOCK}\n\nprose two.`;
	const cleaned = stripStatusBarText(text);
	assert.equal(cleaned.includes("Status_block"), false);
	assert.equal(cleaned.includes("prose one."), true);
	assert.equal(cleaned.includes("prose two."), true);
});

test("strip: two blocks all removed", () => {
	const text = `one.\n\n${BLOCK}\n\ntwo.\n\n${BLOCK}`;
	const { cleaned, blocks } = extractStatusBarBlocks(text);
	assert.equal(cleaned.includes("Status_block"), false);
	assert.equal(blocks.length, 2);
});

test("unclosed block not stripped", () => {
	const text = `start\n<Status_block>\n[HEAD]\nno close\nmore prose`;
	const { cleaned, blocks } = extractStatusBarBlocks(text);
	assert.equal(blocks.length, 0);
	assert.equal(cleaned.includes("more prose"), true);
});

test("parse: head + fields", () => {
	const snap = parseStatusBarBlock(BLOCK);
	assert.equal(snap.characters[0].head, "[HEAD line 1 | HEAD line 2]");
	const labels = snap.characters[0].fields.map((f) => f.label);
	assert.ok(labels.includes("[name]"));
	assert.ok(labels.includes("[action]"));
	const fans = snap.characters[0].fields.find((f) => f.label === "[fans]");
	assert.equal(fans?.value, "285k");
	const diary = snap.characters[0].fields.find((f) => f.label === "[diary]");
	assert.ok(diary);
	const time = snap.characters[0].fields.find((f) => f.label === "[time]");
	assert.equal(time?.value, "2min ago");
});

test("latest snapshot picks last block", () => {
	const text = `one.\n\n${BLOCK}\n\ntwo.\n\n${BLOCK}`;
	const snap = latestStatusBarSnapshot(text);
	assert.ok(snap);
	assert.equal(snap?.characters[0].head, "[HEAD line 1 | HEAD line 2]");
});

test("no block -> null", () => {
	assert.equal(latestStatusBarSnapshot("plain prose"), null);
	assert.equal(latestStatusBarSnapshot(""), null);
});

test("spelling variants", () => {
	const v1 = `<StatusBlock>\n[HEAD]\n<details><summary>s</summary>\n- [n] A\n</details>\n</StatusBlock>`;
	const v2 = v1.replace("StatusBlock", "status_block");
	assert.equal(stripStatusBarText(v1).includes("HEAD"), false);
	assert.equal(stripStatusBarText(v2).includes("HEAD"), false);
	assert.equal(latestStatusBarSnapshot(v1)?.characters[0].fields[0]?.label, "[n] A");
});

// ---------------- 彻底工具化：模板提取 + 账本渲染 ----------------

const CARD_SAMPLE = `你来了。
<Status_block>
『📅 日期：7月15日 | ⏰ 时间：14:30 | 📍 位置：1号软卧包厢』
<details><summary>[角色状态]</summary>
- 苏小棉的状态
  - 👤 姓名：苏小棉（棉宝/棉棉喵）
  - 📝 当前行动：发完推文
  - 💭 当前内心：*信号断了……*
  - 👗 当前穿搭：水手服衬衫
  - 🚂 车厢气味：【Level 2】闷汗酸味
  - 📊 粉丝数：28.5万
  - 🔥 福利度：38/100
</details>
</Status_block>`;

test("extractStatusBarTemplate：从卡文本提取字段清单与骨架", () => {
	const tpl = extractStatusBarTemplate([CARD_SAMPLE]);
	assert.ok(tpl);
	assert.equal(tpl?.head, "『📅 日期：7月15日 | ⏰ 时间：14:30 | 📍 位置：1号软卧包厢』");
	assert.ok(tpl?.fieldLabels.includes("👤 姓名"));
	assert.ok(tpl?.fieldLabels.includes("📝 当前行动"));
	assert.ok(tpl?.fieldLabels.includes("🚂 车厢气味"));
	assert.ok(tpl?.rows.some((r) => r.kind === "static" && r.text.includes("<details>")), "骨架行保留");
});

test("extractStatusBarTemplate：无状态栏示例返回 null", () => {
	assert.equal(extractStatusBarTemplate(["只有正文，没有格式"]), null);
	assert.equal(extractStatusBarTemplate([]), null);
});

test("renderStatusBarHead：head 段按账本值替换", () => {
	const head = "『📅 日期：7月15日 | ⏰ 时间：14:30 | 📍 位置：1号软卧包厢』";
	const out = renderStatusBarHead(head, { "日期": "7月16日", "位置": "2号软卧包厢" });
	assert.equal(out, "『📅 日期：7月16日 | ⏰ 时间：14:30 | 📍 位置：2号软卧包厢』");
});

test("renderStatusBarFromState：账本 → 状态栏块（字段填值、静态骨架保留）", () => {
	const tpl = extractStatusBarTemplate([CARD_SAMPLE]);
	assert.ok(tpl);
	const text = renderStatusBarFromState(
		tpl!,
		{ time: "21:00", location: "走廊" },
		{
			"日期": "7月15日",
			"👤 姓名": "苏小棉（棉棉喵）",
			"📝 当前行动": "假装伸懒腰",
			"📊 粉丝数": "28.6万",
		},
	);
	assert.ok(text.includes("<Status_block>"), "块壳在场");
	assert.ok(text.includes("📝 当前行动：假装伸懒腰"), "字段值已填");
	assert.ok(text.includes("👤 姓名：苏小棉（棉棉喵）"), "字段值已填");
	assert.ok(text.includes("<details>"), "骨架保留");
	// 账本无值的顶层字段继承卡示例值（不露空行、不靠每拍推断）
	assert.ok(text.includes("💭 当前内心：*信号断了……*"), "缺省继承卡示例值");
	assert.ok(text.includes("👗 当前穿搭：水手服衬衫"), "静态字段继承卡示例值");
	// head 段替换（账本 time/location 兜底）
	assert.ok(text.includes("📍 位置：走廊"), "head 位置已替换");
	assert.ok(text.includes("⏰ 时间：21:00"), "head 时间已替换");
	// 渲染产物可被 parse 成快照（与 wire 管道一致）
	const snap = parseStatusBarBlock(text);
	assert.equal(snap.characters[0].fields.find((f) => f.label === "📝 当前行动")?.value, "假装伸懒腰");
});

test("renderStatusBarFromState：静态字段继承卡模板示例值（账号/粉丝数不靠每拍推断）", () => {
	const tpl = extractStatusBarTemplate([CARD_SAMPLE]);
	assert.ok(tpl);
	// 只给动态字段账本值；静态字段（👤 姓名等）缺省 → 用卡示例
	const text = renderStatusBarFromState(tpl!, {}, {
		"📝 当前行动": "假装伸懒腰",
	});
	assert.ok(text.includes("📝 当前行动：假装伸懒腰"), "动态字段用账本值");
	// CARD_SAMPLE 里 👤 姓名示例值 = 苏小棉（棉宝/棉棉喵）
	assert.ok(text.includes("👤 姓名：苏小棉（棉宝/棉棉喵）"), "静态字段继承卡示例值");
	// 「未提及」视为无值 → fallback 卡示例
	const withNa = renderStatusBarFromState(tpl!, {}, {
		"📝 当前行动": "未提及",
	});
	assert.ok(withNa.includes("📝 当前行动："), "未提及时用卡示例");
	assert.ok(!withNa.includes("未提及"), "未提及不进渲染");
});

test("extractStatusBarTemplate：字段清单只含顶层字段（子结构不单独列）", () => {
	const nested = `你来了。
<Status_block>
『📅 日期：7月15日』
<details><summary>[角色状态]</summary>
- 苏小棉的状态
  - 👤 姓名：苏小棉（棉宝/棉棉喵）
  - 🐦 推特日记：
    - ⏱️ 时间：2分钟前
    - 推文：坐长途火车好无聊呀~
    - 💬 评论：
      - 孙吧在逃鼠鼠：虽然知道是营业
</details>
</Status_block>`;
	const tpl = extractStatusBarTemplate([nested]);
	assert.ok(tpl);
	assert.ok(tpl?.fieldLabels.includes("👤 姓名"), "顶层字段在场");
	assert.ok(tpl?.fieldLabels.includes("🐦 推特日记"), "顶层字段在场");
	assert.ok(!tpl?.fieldLabels.includes("时间"), "子字段（⏱️ 时间）不单独列");
	assert.ok(!tpl?.fieldLabels.includes("孙吧在逃鼠鼠"), "评论名不单独列");
});

// ---------------- 卡自带美化模板（皮肤）：导入时抓取，harness 填充 ----------------

test("parseGroupCount：捕获组数解析（跳过非捕获组/断言/转义/字符类）", () => {
	assert.equal(parseGroupCount("/a(b)c/"), 1);
	assert.equal(parseGroupCount("/a(b)(c)/"), 2);
	assert.equal(parseGroupCount("/a(?:b)(c)/"), 1, "非捕获组不计");
	assert.equal(parseGroupCount("/a(?=b)(c)/"), 1, "断言不计");
	assert.equal(parseGroupCount("/a\\(b\\)(c)/"), 1, "转义括号不计");
	assert.equal(parseGroupCount("/a[(]b(c)/"), 1, "字符类内括号不计");
	assert.equal(parseGroupCount("/a(?<name>b)(c)/"), 2, "具名组计入");
	assert.equal(parseGroupCount("plain"), 0);
});

const SKIN_CARD = {
	data: {
		name: "苏小棉",
		first_mes: "你来了。\n<Status_block>\n『📅 日期：7月15日 | ⏰ 时间：14:30 | 📍 位置：1号软卧包厢』\n<details><summary>[角色状态]</summary>\n- 苏小棉的状态\n  - 👤 姓名：苏小棉（棉宝/棉棉喵）\n  - 📝 当前行动：发完推文\n</details>\n</Status_block>",
		extensions: {
			regex_scripts: [
				{
					scriptName: "福利姬状态栏·容器头",
					findRegex: "/<Status_block>\\s*『📅 日期：(.*?) \\| ⏰ 时间：(.*?) \\| 📍 位置：(.*?)』\\s*<details><summary>\\[角色状态\\]<\\/summary>/",
					replaceString: "<style>.flj{color:#fff}</style><div class=\"flj\"><span>$1</span><span>$2</span><span>$3</span>",
				},
				{
					scriptName: "福利姬状态栏·角色卡",
					findRegex: "/- (.+?)的状态\\s*- 👤 姓名：(.+?)\\s*- 📝 当前行动：(.+?)/",
					replaceString: "<article class=\"flj-post\"><h3>$1</h3><p>$2</p><p>$3</p>",
				},
				{
					scriptName: "福利姬状态栏·容器尾",
					findRegex: "/\\s*<\\/details>\\s*<\\/Status_block>/",
					replaceString: "</div>",
				},
			],
		},
	},
};

test("extractStatusBarSkin：抓取美化模板链（HTML 模板 + 捕获组数）", () => {
	const skin = extractStatusBarSkin(SKIN_CARD);
	assert.ok(skin);
	assert.equal(skin?.scripts.length, 3, "链式脚本全收");
	assert.equal(skin?.scripts[0].groupCount, 3, "容器头 3 组（日期/时间/位置）");
	assert.equal(skin?.scripts[1].groupCount, 3, "角色卡 3 组");
	assert.ok(skin?.scripts[0].template.includes("<style>"), "模板是 HTML");
	assert.equal(extractStatusBarSkin({ data: { first_mes: "无" } }), null);
});

test("fillTemplate：$n 按槽位填充（非正则替换）", () => {
	assert.equal(fillTemplate("a$1b$2c", ["X", "Y"]), "aXbYc");
	assert.equal(fillTemplate("$1-$3", ["X", "Y"]), "X-", "缺槽位为空");
	assert.equal(fillTemplate("no dollars", ["X"]), "no dollars");
	assert.equal(fillTemplate("$10", ["a", "b"]), "", "十号槽缺 → 空");
});

test("escapeHtml：模板填充防注入", () => {
	assert.equal(escapeHtml("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;");
});

test("renderStatusBarHtml：模板链填充 → 完整 HTML", () => {
	const skin = extractStatusBarSkin(SKIN_CARD);
	assert.ok(skin);
	const html = renderStatusBarHtml(skin!, ["7月16日", "21:00", "走廊", "苏小棉", "苏小棉（棉棉喵）", "假装伸懒腰"]);
	assert.ok(html.includes("<style>"), "容器头模板在场");
	assert.ok(html.includes("7月16日"), "$1 填充日期");
	assert.ok(html.includes("21:00"), "$2 填充时间");
	assert.ok(html.includes("假装伸懒腰"), "字段值填充");
	assert.ok(html.includes("</div>"), "容器尾模板在场");
});

test("buildStatusBarValueSlots：head 段值 + 字段值（账本优先、示例兜底）", () => {
	const tpl = extractStatusBarTemplate([CARD_SAMPLE]);
	assert.ok(tpl);
	const slots = buildStatusBarValueSlots(tpl!, { time: "21:00", location: "走廊" }, {
		"日期": "7月16日",
		"📝 当前行动": "假装伸懒腰",
	});
	assert.ok(slots[0] === "7月16日", "head 日期槽");
	assert.ok(slots[1] === "21:00", "head 时间槽（账本 time 兜底）");
	assert.ok(slots[2] === "走廊", "head 位置槽");
	const actionIdx = tpl!.fieldLabels.indexOf("📝 当前行动");
	assert.ok(slots[3 + actionIdx] === "假装伸懒腰", "字段槽账本值");
	const nameIdx = tpl!.fieldLabels.indexOf("👤 姓名");
	assert.ok(slots[3 + nameIdx] === "苏小棉（棉宝/棉棉喵）", "字段槽示例兜底");
});