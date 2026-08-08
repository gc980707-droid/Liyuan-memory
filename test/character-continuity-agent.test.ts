import assert from "node:assert/strict";
import test from "node:test";
import { buildCharacterContinuityPrompt, parseCharacterContinuityAgent } from "../src/character-continuity-agent.ts";

test("角色连续性 Agent 只允许目标、关系和未完成事项路径", () => {
	const prompt = buildCharacterContinuityPrompt({ userText: "答应下次见面", narrative: "她认真点头。", currentMvu: "{}", characterNames: ["Alice"] });
	assert.match(prompt.systemPrompt, /goals/);
	assert.match(prompt.systemPrompt, /不要修改时间/);
	assert.equal(parseCharacterContinuityAgent('{"operations":[{"op":"replace","path":"/characters/Alice/goals","value":["下次见面"]},{"op":"replace","path":"/time","value":"夜晚"}]}')?.length, 1);
});
