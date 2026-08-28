import assert from "node:assert/strict";
import { test } from "node:test";

import { applyMvuPatch, applyWorldPatchToMvu, mvuTimePatchIfMissing, parseGreetingInitvar } from "../src/mvu.ts";

test("parseGreetingInitvar：读取开场白专属 YAML 初始状态", () => {
	const state = parseGreetingInitvar(`<UpdateVariable>\n<Initvar>\n坐标:\n  时间: 2026-06-01 14:30\n  当前状态: 普通-零号大坝\n主角:\n  资产:\n    场币: 15000\n</Initvar>\n</UpdateVariable>`);
	assert.equal(state?.坐标?.时间, "2026-06-01 14:30");
	assert.equal(state?.坐标?.当前状态, "普通-零号大坝");
	assert.equal(state?.主角?.资产?.场币, 15000);
});

test("parseGreetingInitvar：没有初始块时返回 null", () => {
	assert.equal(parseGreetingInitvar("普通开场正文"), null);
});

test("applyMvuPatch：更新点路径且不修改原树", () => {
	const before = { 坐标: { 时间: "14:30", 当前位置: { 具体设施: "休息室" } } };
	const after = applyMvuPatch(before, { "坐标.时间": "14:40", "坐标.当前位置.具体设施": "茶几旁" });
	assert.equal(after.坐标.时间, "14:40");
	assert.equal(after.坐标.当前位置.具体设施, "茶几旁");
	assert.equal(before.坐标.时间, "14:30");
});

test("MVU 时间：通用补丁不得覆盖更晚时间", () => {
	const before = { 坐标: { 时间: "2026-06-01 14:45" } };
	const patch = mvuTimePatchIfMissing(before, { time: "2026-06-01 14:44" });
	const after = applyWorldPatchToMvu(before, patch);
	assert.equal((after.坐标 as Record<string, unknown>).时间, "2026-06-01 14:50");
});

test("MVU 物品投影：保险箱物品不复制到背包", () => {
	const before = { 主角: { 资产: { 背包内容: { 存放物品: {} }, 保险箱内容: { 存放物品: {} } } } };
	const after = applyWorldPatchToMvu(before, { inventory: ["(紫)铭牌（保险箱内）", "(绿)水手哨"] });
	const assets = after.主角.资产 as Record<string, any>;
	assert.deepEqual(assets.背包内容.存放物品, { "(绿)水手哨": 1 });
	assert.deepEqual(assets.保险箱内容.存放物品, { "(紫)铭牌": "a1" });
});
