import assert from "node:assert/strict";
import test from "node:test";
import { buildCharacterStatePrompt, parseCharacterStateAgent } from "../src/character-state-agent.ts";

test("角色状态 Agent 只输出结构化操作", () => {
	const prompt = buildCharacterStatePrompt({ userText: "起来上厕所", narrative: "苏小棉抬眼看了一下。", currentMvu: "{}", characterNames: ["苏小棉"] });
	assert.ok(prompt.systemPrompt.includes("唯一 JSON"));
	assert.deepEqual(parseCharacterStateAgent('{"operations":[{"op":"replace","path":"/苏小棉/行动","value":"观察98"}]}')?.[0]?.path, "/苏小棉/行动");
});

test("角色状态 Agent 只注入当前角色的世界书档案", () => {
	const prompt = buildCharacterStatePrompt({
		userText: "苏小棉换上外套。",
		narrative: "苏小棉低头整理袖口。",
		currentMvu: "{}",
		characterNames: ["苏小棉"],
		characterProfiles: { 苏小棉: "她是列车上的乘务员。", 林夏: "不应进入本轮提示。" },
	});
	assert.match(prompt.systemPrompt, /她是列车上的乘务员/);
	assert.doesNotMatch(prompt.systemPrompt, /不应进入本轮提示/);
});
