import assert from "node:assert/strict";
import { test } from "node:test";

import { projectMvuToWorldState } from "../src/mvu.ts";
import { defaultState } from "../src/state.ts";

test("projectMvuToWorldState：MVU 是权威，通用账本同步摘要", () => {
	const state = {
		...defaultState(),
		time: "旧时间",
		location: "旧地点",
		mvu: {
			坐标: {
				时间: "2026-06-01 15:00",
				当前状态: "普通-零号大坝",
				当前位置: { 区域: "游客中心", 具体设施: "茶几旁" },
			},
			在场角色列表: { "云小音【1断颈】": true },
			角色列表: { "云小音【1断颈】": { 当前状态: "尸体", 当前身份: "教程目标" } },
			主角: { 资产: { 背包内容: { 存放物品: { "旧手机": 1 } } } },
		},
	};
	const projected = projectMvuToWorldState(state);
	assert.equal(projected.time, "2026-06-01 15:00");
	assert.equal(projected.location, "普通-零号大坝 游客中心 茶几旁");
	assert.equal(projected.characters["云小音【1断颈】"]?.status, "尸体");
	assert.deepEqual(projected.inventory, ["旧手机 ×1"]);
	assert.equal(projected.mvu?.坐标?.时间, "2026-06-01 15:00");
});

test("projectMvuToWorldState：不把较早 MVU 时间投影回顶层", () => {
	const projected = projectMvuToWorldState({
		...defaultState(),
		time: "2026-06-01 14:45",
		mvu: { 坐标: { 时间: "2026-06-01 14:44" } },
	});
	assert.equal(projected.time, "2026-06-01 14:45");
	assert.equal(projected.mvu?.坐标?.时间, "2026-06-01 14:44");
});

test("projectMvuToWorldState：保险箱物品进入摘要但不伪装成背包", () => {
	const projected = projectMvuToWorldState({
		...defaultState(),
		mvu: {
			主角: {
				资产: {
					背包内容: { 存放物品: { 水手哨: 1 } },
					保险箱内容: { 存放物品: { 铭牌: "a1" } },
				},
			},
		},
	});
	assert.deepEqual(projected.inventory, ["水手哨 ×1", "铭牌（保险箱内）"]);
});
