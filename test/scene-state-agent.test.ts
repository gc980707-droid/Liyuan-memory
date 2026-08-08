import assert from "node:assert/strict";
import test from "node:test";
import { buildSceneStatePrompt, formatSceneStateAdvice, parseSceneStateAdvice } from "../src/scene-state-agent.ts";

test("场景状态 Agent 输出在场角色和知识边界", () => {
	const prompt = buildSceneStatePrompt({ text: "Alice 看向 Bob。", characterNames: ["Alice", "Bob"], worldState: "地点：车厢" });
	assert.match(prompt.systemPrompt, /当前场景/);
	const advice = parseSceneStateAdvice('{"present":["Alice","Bob","陌生人"],"focus":"Alice","background":["Bob"],"knowledgeBoundaries":["Bob 不知道私下谈话"]}');
	assert.deepEqual(advice?.present, ["Alice", "Bob", "陌生人"]);
	assert.match(formatSceneStateAdvice(advice!, ["Alice", "Bob"]), /当前在场：Alice、Bob/);
	assert.doesNotMatch(formatSceneStateAdvice(advice!, ["Alice", "Bob"]), /陌生人/);
});
