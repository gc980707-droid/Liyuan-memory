import assert from "node:assert/strict";
import { test } from "node:test";

import { shouldApplyStoryPreset } from "../src/turn-intent.ts";

test("默认 / 剧情句走预设", () => {
	assert.equal(shouldApplyStoryPreset("我推门走进听雨轩。"), true);
	assert.equal(shouldApplyStoryPreset("青梧，再倒一杯茶。"), true);
	assert.equal(shouldApplyStoryPreset("我该怎么办"), true, "求方向仍是剧情共创");
	assert.equal(shouldApplyStoryPreset(""), true);
});

test("纯办事 / 维护跳过预设", () => {
	assert.equal(shouldApplyStoryPreset("更新角色仓库面板"), false);
	assert.equal(shouldApplyStoryPreset("把青梧和旅人写进角色仓库"), false);
	assert.equal(shouldApplyStoryPreset("切换模型到 deepseek"), false);
	assert.equal(shouldApplyStoryPreset("改一下预设采样"), false);
	assert.equal(shouldApplyStoryPreset("帮我生图：听雨轩夜景"), false);
	assert.equal(shouldApplyStoryPreset("只改面板，别写正文"), false);
	assert.equal(shouldApplyStoryPreset("委托助手诊断连接"), false);
});

test("场外标记跳过预设", () => {
	assert.equal(shouldApplyStoryPreset("//看看当前配置"), false);
	assert.equal(shouldApplyStoryPreset("（把温度调低）"), false);
	assert.equal(shouldApplyStoryPreset("((ooc: 存设定))"), false);
});

test("混写 / 办完续写仍走预设", () => {
	assert.equal(shouldApplyStoryPreset("更新角色仓库然后继续"), true);
	assert.equal(shouldApplyStoryPreset("改完面板接着写"), true);
	assert.equal(shouldApplyStoryPreset("生图之后推进剧情"), true);
	assert.equal(shouldApplyStoryPreset("办完继续"), true);
});

test("超长用户段默认剧情（避免误伤长 OOC 列表边缘）", () => {
	const longIc = "我".repeat(300) + "推门而入。";
	assert.equal(shouldApplyStoryPreset(longIc), true);
});
