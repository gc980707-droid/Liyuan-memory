import { test } from "node:test";
import assert from "node:assert/strict";
import {
	extractStatusBarBlocks,
	extractStatusBarTemplate,
	latestStatusBarSnapshot,
	parseStatusBarBlock,
	renderStatusBarFromState,
	renderStatusBarHead,
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
	// 未记账字段整行跳过（模板子结构/缺失字段不露空行）
	assert.ok(!text.includes("💭 当前内心"), "无账本值的字段整行跳过");
	assert.ok(!text.includes("当前穿搭"), "未记账字段不出现");
	// head 段替换（账本 time/location 兜底）
	assert.ok(text.includes("📍 位置：走廊"), "head 位置已替换");
	assert.ok(text.includes("⏰ 时间：21:00"), "head 时间已替换");
	// 未记账字段整行跳过（模板子结构不露空行）
	assert.ok(!text.includes("💭 当前内心："), "无账本值的字段整行跳过");
	assert.ok(!text.includes("当前穿搭"), "未记账字段不出现");
	// 渲染产物可被 parse 成快照（与 wire 管道一致）
	const snap = parseStatusBarBlock(text);
	assert.equal(snap.characters[0].fields.find((f) => f.label === "📝 当前行动")?.value, "假装伸懒腰");
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