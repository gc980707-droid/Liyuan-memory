import assert from "node:assert/strict";
import test from "node:test";
import { gateTimePatch, hasExplicitTimeAdvance } from "../src/time-gate.ts";

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
