import assert from "node:assert/strict";
import test from "node:test";
import { buildIndependentReviewPrompt, buildRewriteAgentPrompt, parseIndependentReview, parseRewriteAgentResponse, validateRewriteAgentResponse } from "../src/rewrite-agent.ts";

test("rewrite agent response requires review scores and applies atomic unique patches", () => {
	const raw = JSON.stringify({ patches: [{ old: "他笑了", new: "他唇角微微一动", reason: "去模板化", rule: "句式", confidence: 0.95 }], review: { meaning: 0.9, voice: 0.9, continuity: 0.9 } });
	const parsed = parseRewriteAgentResponse(raw);
	const result = validateRewriteAgentResponse("他笑了。", parsed);
	assert.equal(result.ok, true);
	assert.equal(result.text, "他唇角微微一动。");
});

test("rewrite agent rejects ambiguous patches and protects markup atomically", () => {
	const parsed = parseRewriteAgentResponse(JSON.stringify({ patches: [{ old: "八股", new: "自然", reason: "", rule: "", confidence: 1 }], review: { meaning: 1, voice: 1, continuity: 1 } }));
	const result = validateRewriteAgentResponse("八股 八股", parsed);
	assert.equal(result.ok, false);
	assert.equal(result.text, "八股 八股");
	const protectedResult = validateRewriteAgentResponse("八股 <StatusPlaceHolderImpl/>", parsed);
	assert.equal(protectedResult.ok, true);
	assert.equal(protectedResult.text, "自然 <StatusPlaceHolderImpl/>");
});

test("rewrite agent prompt explicitly forbids facts and protected ranges", () => {
	const prompt = buildRewriteAgentPrompt({ text: "正文", rulesSummary: "句式", protectedRanges: "状态栏" });
	assert.match(prompt.systemPrompt, /不改写事实/);
	assert.match(prompt.userText, /状态栏/);
});

test("independent review requires all scores and rejects new facts", () => {
	const prompt = buildIndependentReviewPrompt("她看向门口。", "她看向门口，拔出了刀。");
	assert.match(prompt.systemPrompt, /独立/);
	const review = parseIndependentReview('{"meaning":0.95,"voice":0.9,"continuity":0.9,"introducesFacts":true}');
	assert.equal(review?.introducesFacts, true);
	assert.equal(parseIndependentReview("bad"), null);
});
