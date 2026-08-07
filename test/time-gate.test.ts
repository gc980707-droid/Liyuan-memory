import assert from "node:assert/strict";
import test from "node:test";
import { gateStatusTime, gateTimePatch, hasExplicitTimeAdvance, inferActionDuration } from "../src/time-gate.ts";

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

test("状态栏时间不能绕过世界状态门禁", () => {
	assert.equal(gateStatusTime("起来上厕所", "7月15日14:30", "📅 7月15日 | ⏰ 14:45").allowed, false);
	assert.equal(gateStatusTime("过了十五分钟", "7月15日14:30", "⏰ 14:45").allowed, true);
});
