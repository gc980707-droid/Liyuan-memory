import assert from "node:assert/strict";
import test from "node:test";
import { coreCharacterNames } from "../src/character-roster.ts";

test("核心角色名过滤世界书规则条目", () => {
	const names = coreCharacterNames({ name: "苏小棉" } as never, [
		{ comment: "林夏", keys: ["夏夏"], content: "人物资料" },
		{ comment: "文风规则", keys: [], content: "很长的规则" },
	] as never);
	assert.deepEqual(names, ["苏小棉", "林夏"]);
});

test("角色调度排除卡标题、用户和不在场角色", () => {
	const names = coreCharacterNames({ name: "火车站上的臭福利姬们" } as never, [
		{ comment: "苏小棉", keys: ["棉宝"], content: "人物资料" },
		{ comment: "林夏", keys: ["夏夏"], content: "人物资料" },
	], { userName: "{{user}}", sceneText: "苏小棉抬头看向窗外" });
	assert.deepEqual(names, ["苏小棉"]);
});
