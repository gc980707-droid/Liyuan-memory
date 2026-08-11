import { test } from "node:test";
import assert from "node:assert/strict";
import { extractStatusBarBlocks, stripAllStatusBarArtifacts, stripStatusBarText } from "../src/statusbar.ts";

test("stripStatusBarText：正文中的状态栏块被剥离，留下叙事", () => {
	const text = `旅人站起身。\n\n<Status_block>\n『📅 日期：7月14日』\n<details><summary>[角色状态]</summary>\n- 👤 姓名：苏小棉\n</details>\n</Status_block>\n\n他走到连接处。`;
	const cleaned = stripStatusBarText(text);
	assert.equal(cleaned.includes("Status_block"), false);
	assert.equal(cleaned.includes("旅人站起身。"), true);
	assert.equal(cleaned.includes("他走到连接处。"), true);
});

test("stripStatusBarText：无闭合残块不吞正文", () => {
	const text = `正文开头\n<Status_block>\n『📅 日期：…』\n残块没有闭合\n后面还有正文`;
	const { cleaned, blocks } = extractStatusBarBlocks(text);
	assert.equal(blocks.length, 0);
	assert.equal(cleaned.includes("后面还有正文"), true);
});

test("stripAllStatusBarArtifacts：占位符与成对块一起清（导入清理）", () => {
	const text = `你来了。\n<Status_block>\n『📅 日期：x』\n</Status_block>\n<StatusPlaceHolderImpl/>\n正文明明在。`;
	const cleaned = stripAllStatusBarArtifacts(text);
	assert.equal(cleaned.includes("Status_block"), false);
	assert.equal(cleaned.includes("StatusPlaceHolderImpl"), false);
	assert.equal(cleaned.includes("正文明明在"), true);
});

test("stripAllStatusBarArtifacts：HTML 标准自闭合标签保留", () => {
	const text = `<br/>正常<br />文本 <img src="a.png"/> 结尾`;
	assert.equal(stripAllStatusBarArtifacts(text), text);
});
