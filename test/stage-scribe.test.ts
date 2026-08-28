import assert from "node:assert/strict";
import { test } from "node:test";

import { runScribeTurn, type ScribeRunDeps } from "../src/stage/scribe-run.ts";
import { defaultState } from "../src/state.ts";
import type { WorldState } from "../src/types.ts";

const baseInput = {
	state: defaultState(),
	userText: "我把怀表递给她。",
	assistantText: "云澜接过怀表，指尖顿了顿。",
	charName: "云澜",
	userName: "沈舟",
};

/** 记录落树与落盘的假依赖 */
const makeDeps = (
	respond: string | { error: string },
	over: Partial<ScribeRunDeps> = {},
): ScribeRunDeps & { entries: WorldState[]; activities: string[]; prompts: string[] } => {
	const entries: WorldState[] = [];
	const activities: string[] = [];
	const prompts: string[] = [];
	return {
		entries,
		activities,
		prompts,
		sideText: async (_sp, ut) => {
			prompts.push(ut);
			return respond;
		},
		appendStateEntry: (s) => entries.push(s),
		getLeafId: () => "leaf-1",
		onActivity: (d) => activities.push(d),
		...over,
	};
};

test("场记：patch 落账 + rp-state 快照落树 + 过程条", async () => {
	const deps = makeDeps(
		JSON.stringify({
			patch: {
				time: "戌时",
				location: "溪桥",
				characters: { 云澜: { affinity: 6, status: "手持怀表" } },
				inventory: ["黄铜怀表（云澜持有）"],
			},
		}),
	);
	const r = await runScribeTurn(deps, baseInput);

	assert.equal(r.kind, "applied");
	assert.equal(deps.entries.length, 1, "一条 rp-state 快照");
	const snap = deps.entries[0];
	assert.equal(snap.time, "戌时");
	assert.equal(snap.location, "溪桥");
	assert.equal(snap.characters["云澜"]?.affinity, 6);
	assert.deepEqual(snap.inventory, ["黄铜怀表（云澜持有）"]);
	assert.ok(deps.activities.some((a) => a.startsWith("记账")), "有记账过程条");
	// 场记看到的是账本 + 本拍对白
	assert.ok(deps.prompts[0].includes("云澜接过怀表"));
});

test("场记：叶守卫——调用期间分支变了则整体丢弃（R9）", async () => {
	let leaf = "leaf-1";
	const deps = makeDeps(JSON.stringify({ patch: { time: "亥时" } }), {
		sideText: async () => {
			leaf = "leaf-2"; // 模拟调用期间用户 swipe
			return JSON.stringify({ patch: { time: "亥时" } });
		},
		getLeafId: () => leaf,
	});
	const r = await runScribeTurn(deps, baseInput);

	assert.equal(r.kind, "stale");
	assert.equal(deps.entries.length, 0, "废弃分支的账本绝不落树");
	assert.ok(deps.activities.some((a) => a.includes("切换了分支")));
});

test("场记：空 patch / 不可解析 / 调用失败都不落树", async () => {
	const empty = makeDeps(JSON.stringify({ patch: {} }));
	assert.deepEqual(await runScribeTurn(empty, baseInput), { kind: "skipped", reason: "empty-patch" });
	assert.equal(empty.entries.length, 0);

	const garbage = makeDeps("模型今天想聊天，不想输出 JSON。");
	const gr = await runScribeTurn(garbage, baseInput);
	assert.equal(gr.kind, "failed");
	assert.ok(gr.kind === "failed" && gr.error.includes("不可解析"), "失败信息带原文，便于诊断格式跑偏");
	assert.equal(garbage.entries.length, 0);

	const failed = makeDeps({ error: "429 rate limited" });
	assert.deepEqual(await runScribeTurn(failed, baseInput), { kind: "failed", error: "429 rate limited" });
	assert.equal(failed.entries.length, 0);

	const noText = makeDeps(JSON.stringify({ patch: { time: "子时" } }));
	assert.deepEqual(await runScribeTurn(noText, { ...baseInput, assistantText: "  " }), {
		kind: "skipped",
		reason: "no-text",
	});
	assert.equal(noText.entries.length, 0, "空正文不该发起调用");
});

test("场记：MVU 回合没有显式时间也自动推进五分钟", async () => {
	const state = {
		...defaultState(),
		mvu: { 坐标: { 时间: "2026-06-01 14:30" } },
	};
	const deps = makeDeps(JSON.stringify({ mvu_patch: {} }));
	const r = await runScribeTurn(deps, { ...baseInput, state });

	assert.equal(r.kind, "applied");
	assert.equal((deps.entries[0].mvu?.坐标 as Record<string, unknown>).时间, "2026-06-01 14:35");
});

test("场记：MVU 时间不得倒退", async () => {
	const state = {
		...defaultState(),
		mvu: { 坐标: { 时间: "2026-06-01 14:45" } },
	};
	const deps = makeDeps(JSON.stringify({ mvu_patch: { "坐标.时间": "2026-06-01 14:44" } }));
	const r = await runScribeTurn(deps, { ...baseInput, state });

	assert.equal(r.kind, "applied");
	assert.equal((deps.entries[0].mvu?.坐标 as Record<string, unknown>).时间, "2026-06-01 14:50");
});

test("场记：旁路完成后以当前分支快照为基准", async () => {
	let current = { ...defaultState(), time: "2026-06-01 14:45", mvu: { 坐标: { 时间: "2026-06-01 14:45" } } };
	const deps = makeDeps(JSON.stringify({ patch: { time: "2026-06-01 14:44" } }), {
		getCurrentState: () => current,
	});
	const r = await runScribeTurn(deps, { ...baseInput, state: { ...defaultState(), time: "2026-06-01 14:40" } });

	assert.equal(r.kind, "applied");
	assert.equal((deps.entries[0].mvu?.坐标 as Record<string, unknown>).时间, "2026-06-01 14:50");
});

test("场记：用户只观察时不扣弹药、不替用户移动或操作物品", async () => {
	const state = {
		...defaultState(),
		mvu: {
			坐标: { 时间: "2026-06-01 14:45", 当前位置: { 区域: "游客中心", 具体设施: "休息室" } },
			主角: { 资产: { 装备: { "(蓝)步枪弹": 30 }, 背包内容: { 存放物品: {} } } },
		},
	};
	const deps = makeDeps(
		JSON.stringify({
			mvu_patch: {
				"主角.资产.装备.(蓝)步枪弹": 28,
				"坐标.当前位置.具体设施": "楼梯口",
				"主角.资产.背包内容.存放物品": { 手雷: 1 },
			},
		}),
	);
	const r = await runScribeTurn(deps, { ...baseInput, state, userText: "我继续举着枪，看着门口" });
	assert.equal(r.kind, "applied");
	const mvu = deps.entries[0].mvu!;
	assert.equal((mvu.坐标 as Record<string, any>).时间, "2026-06-01 14:50");
	assert.equal((mvu.主角 as Record<string, any>).资产.装备["(蓝)步枪弹"], 30);
	assert.equal((mvu.坐标 as Record<string, any>).当前位置.具体设施, "休息室");
	assert.deepEqual((mvu.主角 as Record<string, any>).资产.背包内容.存放物品, {});
});

test("场记：角色名归一（大小写/空白变体不开新条目）", async () => {
	const state: WorldState = { ...defaultState(), characters: { 云澜: { affinity: 3, status: "", notes: "" } } };
	const deps = makeDeps(JSON.stringify({ patch: { characters: { " 云澜 ": { affinity: 8 } } } }));
	const r = await runScribeTurn(deps, { ...baseInput, state });

	assert.equal(r.kind, "applied");
	assert.deepEqual(Object.keys(deps.entries[0].characters), ["云澜"], "不得记成两份");
	assert.equal(deps.entries[0].characters["云澜"]?.affinity, 8);
});

test("场记：快照带登场名录（applyPatch 咽喉点自动登记）", async () => {
	const deps = makeDeps(
		JSON.stringify({ patch: { characters: { 老松道人: { affinity: 0, status: "山门守卫" } }, plot_threads: ["寻回师门信物"] } }),
	);
	await runScribeTurn(deps, baseInput);
	const roster = deps.entries[0].roster;
	assert.ok(roster?.characters["老松道人"] !== undefined, "人物进名录");
	assert.ok(roster?.events["寻回师门信物"] !== undefined, "剧情线进名录");
});
