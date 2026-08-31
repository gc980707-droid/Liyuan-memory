import assert from "node:assert/strict";
import test from "node:test";
import { applyRewrite, applyRewriteProtected, compileRewriteProcessors, normalizeRewriteRules } from "../src/rewrite-rules.ts";
import { toWireMsg } from "../server/wire.ts";
import { rebuildHistory } from "../src/stage/assemble.ts";
import { rewriteProcessorsForConfig } from "../src/rewrite-rules.ts";

test("rewrite rules normalize array and wrapper, preserving groups and enabled state", () => {
	const a = normalizeRewriteRules({ rules: [{ name: "常用", enabled: false, subRules: [{ mode: "text", targets: ["旧"], replacements: ["新"] }] }] });
	assert.equal(a.rules[0].name, "常用");
	assert.equal(a.rules[0].enabled, false);
	assert.equal(a.rules[0].subRules[0].mode, "text");
});

test("rewrite supports text, regex captures, simple wildcards, deletion, and order", () => {
	const normalized = normalizeRewriteRules([
		{ name: "a", subRules: [{ mode: "text", targets: ["八股"], replacements: ["自然"] }] },
		{ name: "b", subRules: [{ mode: "regex", targets: ["/(你好)(世界)/"], replacements: ["$2$1"] }] },
		{ name: "c", subRules: [{ mode: "simple", targets: ["模板*句"], replacements: [""] }] },
	]);
	const { processors, warnings } = compileRewriteProcessors(normalized.rules);
	assert.equal(warnings.length, 0);
	assert.equal(applyRewrite("八股 你好世界 模板这是句", processors), "自然 世界你好 ");
});

test("invalid and empty regexes are rejected", () => {
	const { processors, warnings } = compileRewriteProcessors([{ name: "x", subRules: [{ mode: "regex", targets: ["/[/", "/.*/"], replacements: ["x"] }] }]);
	assert.equal(processors.length, 0);
	assert.equal(warnings.length, 2);
});

test("protected fences, thinking, and status placeholders remain unchanged", () => {
	const { processors } = compileRewriteProcessors([{ name: "x", subRules: [{ mode: "text", targets: ["八股"], replacements: ["自然"] }] }]);
	const input = "八股\n```八股```\n<thinking>八股</thinking>\n<StatusPlaceHolderImpl/>";
	assert.equal(applyRewriteProtected(input, processors), "自然\n```八股```\n<thinking>八股</thinking>\n<StatusPlaceHolderImpl/>");
});

test("wire visual channel and history opt-in use the same protected rewrite", () => {
	const { processors } = compileRewriteProcessors([{ name: "x", subRules: [{ mode: "text", targets: ["八股"], replacements: ["自然"] }] }]);
	const wire = toWireMsg({ role: "assistant", content: "八股\n```八股```" }, { charName: "c", userName: "u" }, { rewriteProcessors: processors });
	assert.equal(wire?.text, "自然\n```八股```");
	const branch = [
		{ type: "message", message: { role: "user", content: "u" } },
		{ type: "message", message: { role: "assistant", content: "八股" } },
	] as const;
	assert.equal(rebuildHistory([...branch]).history[1].text, "八股");
	assert.equal(rebuildHistory([...branch], processors).history[1].text, "自然");
	assert.equal(toWireMsg({ role: "user", content: "八股" }, { charName: "c", userName: "u" }, { rewriteProcessors: processors })?.text, "八股");
	assert.equal(toWireMsg({ role: "assistant", content: "八股" }, { charName: "c", userName: "u" }, { backstage: true, rewriteProcessors: processors })?.text, "八股");
	const backstageTimeline = toWireMsg({ role: "assistant", content: "八股", details: { rpTimeline: [{ kind: "text", text: "八股" }] } }, { charName: "c", userName: "u" }, { backstage: true, rewriteProcessors: processors });
	assert.equal(backstageTimeline?.timeline?.[0]?.text, "八股");
});

test("rewrite config rejects rule files outside the project rewrite directory", () => {
	const result = rewriteProcessorsForConfig("/tmp/liyuan", { enabled: true, rulesFile: "../secret.json", scope: "visual" }, "visual");
	assert.equal(result.processors.length, 0);
	assert.match(result.warnings[0], /不安全/);
});

test("whitelist matches the complete hit, not a substring", () => {
	const { processors } = compileRewriteProcessors([{ name: "x", subRules: [{ mode: "text", targets: ["他", "他笑了"], replacements: ["自然"] }] }]);
	for (const p of processors) p.whitelist = ["他"];
	assert.equal(applyRewrite("他 他笑了", processors), "他 自然");
});

test("Veridis compatibility: bare regex uses gmu and simple wildcard stops at punctuation", () => {
	const { processors } = compileRewriteProcessors([{ name: "x", subRules: [
		{ mode: "regex", targets: ["^甲$"], replacements: ["乙"] },
		{ mode: "simple", targets: ["模板*句"], replacements: ["替换"] },
	] }]);
	assert.equal(processors[0].regex.flags.includes("m"), true);
	assert.equal(applyRewrite("甲\n模板这是，句 模板这是句", processors), "乙\n模板这是，句 替换");
});
