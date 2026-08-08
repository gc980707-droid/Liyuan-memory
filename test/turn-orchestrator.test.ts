import assert from "node:assert/strict";
import test from "node:test";
import { buildTurnPlan, classifyTurn } from "../src/turn-orchestrator.ts";

test("编排器识别简单动作和耗时", () => {
	assert.equal(classifyTurn("起来上厕所", false), "simple_action");
	const plan = buildTurnPlan("起来上厕所", ["苏小棉", "林夏"]);
	assert.equal(plan.actionDuration?.min, 5);
	assert.deepEqual(plan.affectedCharacters, ["苏小棉"]);
	assert.ok(plan.constraints.some((x) => x.includes("低能量")));
});

test("编排器区分戏外和普通剧情", () => {
	assert.equal(classifyTurn("调整设置", true), "backstage");
	assert.equal(classifyTurn("她抬眼看向窗外，决定暂时不说话。", false), "story");
});
