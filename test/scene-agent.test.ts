import assert from "node:assert/strict";
import { test } from "node:test";

import { buildSceneAgentPrompt, parseSceneAgentResult, sanitizeScenePatch } from "../src/stage/scene-agent.ts";
import { defaultState } from "../src/state.ts";

test("场景记录员：解析 JSON、保留明确意图和场景补丁", () => {
	const result = parseSceneAgentResult(`
\`\`\`json
{"explicit_actions":["放下电话",42],"explicit_needs":["我饿了",null],"patch":{"scene":{"held_items":{"沈云熙":null}}}}
\`\`\`
`);
	assert.deepEqual(result, {
		explicitActions: ["放下电话"],
		explicitNeeds: ["我饿了"],
		patch: { scene: { held_items: { 沈云熙: null } } },
	});
});

test("场景记录员：坏 JSON 和非数组意图安全降级", () => {
	assert.equal(parseSceneAgentResult("不是 JSON"), null);
	assert.deepEqual(parseSceneAgentResult('{"explicit_actions":"我饿了","patch":[]}'), {
		explicitActions: [],
		explicitNeeds: [],
		patch: {},
	});
});

test("场景记录员提示词：禁止凭套路添加抹布、厨房等道具", () => {
	const prompt = buildSceneAgentPrompt({
		state: defaultState(),
		userText: "我饿了。",
		recentText: "沈云熙刚放下电话，发现你醒了。",
		charName: "沈云熙",
		userName: "user",
	});
	assert.ok(prompt.systemPrompt.includes("不要凭空添加抹布、厨房或其他道具"));
	assert.ok(prompt.userText.includes("我饿了"));
});

test("场景记录员补丁：无明确用户输入或越出 scene 面时全部拒绝", () => {
	assert.deepEqual(sanitizeScenePatch({ time: "夜里", scene: { positions: { user: "门口" }, extra: "bad" } }, false), {});
	assert.deepEqual(sanitizeScenePatch({ characters: { x: {} }, scene: { positions: { user: "门口" }, ongoing: ["继续"] } }, true), {
		scene: { positions: { user: "门口" }, ongoing: ["继续"] },
	});
});
