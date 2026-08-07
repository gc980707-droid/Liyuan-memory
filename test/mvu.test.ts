import assert from "node:assert/strict";
import test from "node:test";
import { applyMvuOperations, parseInitVar, parseMvuUpdates, stripMvuUpdates } from "../src/mvu.ts";
import { cleanAssistantText, displayAssistantText } from "../src/postprocess.ts";

test("MVU JSONPatch: replace/delta/insert/remove/move", () => {
	const result = applyMvuOperations({ hp: 10, bag: ["a"], old: "x" }, [
		{ op: "delta", path: "/hp", value: -2 },
		{ op: "insert", path: "/bag/-", value: "b" },
		{ op: "move", from: "/old", to: "/new" },
	]);
	assert.deepEqual(result.data, { hp: 8, bag: ["a", "b"], new: "x" });
});

test("MVU atomic batch: any invalid operation rolls back the whole batch", () => {
	const before = { Alice: { mood: "calm" } };
	const result = applyMvuOperations(before, [
		{ op: "insert", path: "/Alice/mood2", value: "alert" },
		{ op: "delta", path: "/Alice/mood", value: 1 },
	], { atomic: true });
	assert.deepEqual(result.data, before);
	assert.deepEqual(result.applied, []);
	assert.ok(result.warnings.length > 0);
});

test("MVU 解析 JSONPatch 与旧 _.set", () => {
	const text = `<UpdateVariable><JSONPatch>[{"op":"delta","path":"/hp","value":2}]</JSONPatch>\n_.set('name', 'old', 'new');</UpdateVariable>`;
	const ops = parseMvuUpdates(text);
	assert.equal(ops.length, 2);
	assert.equal(ops[1]!.value, "new");
	assert.equal(stripMvuUpdates(`正文${text}结尾`), "正文结尾");
});

test("MVU 禁止原型污染", () => {
	const result = applyMvuOperations({}, [{ op: "insert", path: "/__proto__/polluted", value: true }]);
	assert.equal(result.applied.length, 0);
	assert.ok(result.warnings.length);
	assert.equal(({} as { polluted?: boolean }).polluted, undefined);
});

test("MVU InitVar 解析 JSON5 常见写法", () => {
	assert.deepEqual(parseInitVar(`// init\n{hp:[10,'生命'],}`), { hp: [10, "生命"] });
});

test("MVU 旧式 [值, 描述] 叶节点保留描述", () => {
	const result = applyMvuOperations({ hp: [10, "生命值"] }, [{ op: "delta", path: "/hp", value: -2 }]);
	assert.deepEqual(result.data, { hp: [8, "生命值"] });
});

test("MVU 更新块不进入显示或送模历史", () => {
	const text = "正文<UpdateVariable><JSONPatch>[]</JSONPatch></UpdateVariable>结尾";
	assert.equal(cleanAssistantText(text), "正文结尾");
	assert.equal(displayAssistantText(text), "正文结尾");
});

test("MVU move 目标非法时不删除源", () => {
	const result = applyMvuOperations({ source: 1, scalar: 2 }, [{ op: "move", from: "/source", to: "/scalar/x" }]);
	assert.deepEqual(result.data, { source: 1, scalar: 2 });
});
