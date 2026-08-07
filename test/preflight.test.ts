import assert from "node:assert/strict";
import test from "node:test";
import { formatPreflightAdvice, hardenPreflightAdvice, parsePreflightAdvice } from "../src/preflight.ts";

test("结构化预演 JSON 解析和格式化", () => {
	const advice = parsePreflightAdvice('{"focus":"保持克制","characterIntents":["苏小棉观察用户"],"constraints":["时间以14:30为准"],"avoid":["不要引入陌生角色"]}');
	assert.equal(advice?.focus, "保持克制");
	assert.ok(formatPreflightAdvice(advice!).includes("避免：不要引入陌生角色"));
});

test("预演硬约束把世界状态置于建议之上", () => {
	const advice = hardenPreflightAdvice({ focus: "推进夜间剧情", characterIntents: [], constraints: [], avoid: [] }, "时间：7月15日14:30\n地点：列车包厢");
	const formatted = formatPreflightAdvice(advice);
	assert.ok(formatted.includes("不得擅自修改时间"));
	assert.ok(formatted.includes("7月15日14:30"));
});
