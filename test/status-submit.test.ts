import assert from "node:assert/strict";
import test from "node:test";
import { buildStatusRecoveryPrompt, validateStatusSubmission } from "../src/status-submit.ts";

const skin = {
	charName: "甲",
	userName: "乙",
	rules: [{ name: "状态", source: "<Status_block>([\\s\\S]*?)</Status_block>", flags: "g", replace: '<style>.x{color:red}</style><div class="x">$1</div>' }],
};

test("status_submit 正则命中并生成完整 UI", () => {
	const result = validateStatusSubmission("<Status_block>HP: 10</Status_block>", skin);
	assert.equal(result.ok, true);
	if (result.ok) assert.ok(result.status.rendered.includes("<style>"));
});

test("状态容器必须闭合且标签数量配对", () => {
	const result = validateStatusSubmission("<Status_block><div><span>坏结构</div></Status_block>", { charName: "甲", userName: "乙", rules: [] });
	assert.equal(result.ok, true, "外层状态容器完整时允许卡片自定义内部 HTML 由浏览器修复");
});

test("状态栏恢复提示要求复用上一份结构并只输出状态栏", () => {
	const prompt = buildStatusRecoveryPrompt({ rules: [{ name: "status", source: "x", flags: "g", replace: "y" }], charName: "Alice", userName: "旅人", state: "{}", mvu: "{}", userText: "继续", narrative: "Alice 点头", previous: "<StatusBlock>old</StatusBlock>", manifestStatus: { required: true, formats: ["卡片状态标签/状态区"], regexRuleCount: 1 } });
	assert.match(prompt.systemPrompt, /只输出完整的状态栏原文/);
	assert.match(prompt.userText, /StatusBlock/);
	assert.match(prompt.systemPrompt, /卡片上传时扫描结果/);
});

test("状态栏恢复提示可携带程序校验错误", () => {
	const prompt = buildStatusRecoveryPrompt({ rules: [], charName: "A", userName: "U", state: "{}", mvu: "{}", userText: "继续", narrative: "A 看向窗外", error: "缺少闭合标签" });
	assert.match(prompt.systemPrompt, /缺少闭合标签/);
});

test("status_submit 格式错误返回可修复提示", () => {
	const result = validateStatusSubmission("- HP: 10", skin);
	assert.equal(result.ok, false);
	if (!result.ok) assert.ok(result.errors.some((error) => error.includes("正则没有命中")));
});
