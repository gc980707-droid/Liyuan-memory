import assert from "node:assert/strict";
import test from "node:test";
import { buildCharacterIntentPrompt } from "../src/character-intent-agent.ts";

test("角色动机 Agent 只接收对应角色档案并保持隐藏提案职责", () => {
	const prompt = buildCharacterIntentPrompt({ name: "Alice", profile: "她是医生。", turnPlan: "保持场景连续" });
	assert.match(prompt.systemPrompt, /Alice/);
	assert.match(prompt.systemPrompt, /她是医生/);
	assert.match(prompt.systemPrompt, /不要写正文/);
	assert.match(prompt.systemPrompt, /保持场景连续/);
});
