import assert from "node:assert/strict";
import test from "node:test";
import { formatPreflightAdvice, parsePreflightAdvice } from "../src/preflight.ts";

test("结构化预演 JSON 解析和格式化", () => {
	const advice = parsePreflightAdvice('{"focus":"保持克制","characterIntents":["苏小棉观察用户"],"constraints":["时间以14:30为准"],"avoid":["不要引入陌生角色"]}');
	assert.equal(advice?.focus, "保持克制");
	assert.ok(formatPreflightAdvice(advice!).includes("避免：不要引入陌生角色"));
});
