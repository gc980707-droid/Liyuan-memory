import assert from "node:assert/strict";
import test from "node:test";
import { extractClockTime, gateStatusTime, gateTimePatch, hasExplicitTimeAdvance, inferActionDuration } from "../src/time-gate.ts";

test("普通动作不推进时间", () => {
	assert.equal(hasExplicitTimeAdvance("起来上厕所"), false);
	assert.equal(gateTimePatch("起来上厕所", "7月15日14:30", "7月16日凌晨2:10").allowed, false);
});

test("明确时间语句允许推进", () => {
	assert.equal(hasExplicitTimeAdvance("睡了一觉，醒来已经是深夜"), true);
	assert.equal(gateTimePatch("睡了一觉，醒来已经是深夜", "7月15日14:30", "7月16日凌晨2:10").allowed, true);
});

test("场记同样受时间门禁保护", () => {
	const result = gateTimePatch("起来上厕所", "7月15日14:30", "7月16日凌晨2:10");
	assert.equal(result.allowed, false);
});

test("自然动作允许小范围耗时", () => {
	assert.equal(inferActionDuration("起来上厕所")?.name, "使用卫生间");
	assert.equal(gateTimePatch("起来上厕所", "7月15日14:30", "7月15日14:35").allowed, true);
	assert.equal(gateTimePatch("起来上厕所", "7月15日14:30", "7月15日23:00").allowed, false);
});

test("通用动作通过模型声明耗时，不依赖关键词表", () => {
	assert.equal(gateTimePatch("去花市买花", "7月15日14:30", "7月15日15:10", { action: "往返花市", durationMin: 30, durationMax: 60 }).allowed, true);
	assert.equal(gateTimePatch("去花市买花", "7月15日14:30", "7月15日23:00", { action: "往返花市", durationMin: 30, durationMax: 60 }).allowed, false);
});

test("从开场文本提取时间基准", () => {
	assert.equal(extractClockTime("开场时间：7月15日 14:30，地点：列车包厢"), "14:30");
	assert.equal(extractClockTime("没有时钟信息"), null);
});

test("状态栏时间不能绕过世界状态门禁", () => {
	assert.equal(gateStatusTime("起来上厕所", "7月15日14:30", "📅 7月15日 | ⏰ 14:42").allowed, true);
	assert.equal(gateStatusTime("起来上厕所", "7月15日14:30", "📅 7月15日 | ⏰ 15:00").allowed, false);
	assert.equal(gateStatusTime("过了十五分钟", "7月15日14:30", "⏰ 14:45").allowed, true);
});
