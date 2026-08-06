import assert from "node:assert/strict";
import test from "node:test";
import { validateStatusSubmission } from "../src/status-submit.ts";

const skin = {
	charName: "甲",
	userName: "乙",
	rules: [{ name: "状态", source: "<Status_block>([\\s\\S]*?)</Status_block>", flags: "g", replace: '<style>.x{color:red}</style><div class="x">$1</div>' }],
};

test("status_submit 正则命中并生成完整 UI", () => {
	const result = validateStatusSubmission("<Status_block>HP: 10</Status_block>", skin);
	assert.equal(result.ok, true);
	if (result.ok) assert.ok(result.status.rendered.includes("<style>"));
});

test("status_submit 格式错误返回可修复提示", () => {
	const result = validateStatusSubmission("- HP: 10", skin);
	assert.equal(result.ok, false);
	if (!result.ok) assert.ok(result.errors.some((error) => error.includes("正则没有命中")));
});
