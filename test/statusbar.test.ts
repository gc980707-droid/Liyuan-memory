import { test } from "node:test";
import assert from "node:assert/strict";
import {
	extractStatusBarBlocks,
	latestStatusBarSnapshot,
	parseStatusBarBlock,
	stripStatusBarText,
} from "../src/statusbar.ts";

const BLOCK = `<Status_block>
[HEAD line 1 | HEAD line 2]
<details><summary>[role status]</summary>
- state of A
  - [name]: A (nick)
  - [action]: doing things
  - [thought]: *thinking...*
  - [fans]: 285k
  - [diary]:
    - [time]: 2min ago
    - [tweet]: hello world
</details>
</Status_block>`;

test("strip: removes block keeps prose", () => {
	const text = `prose one.\n\n${BLOCK}\n\nprose two.`;
	const cleaned = stripStatusBarText(text);
	assert.equal(cleaned.includes("Status_block"), false);
	assert.equal(cleaned.includes("prose one."), true);
	assert.equal(cleaned.includes("prose two."), true);
});

test("strip: two blocks all removed", () => {
	const text = `one.\n\n${BLOCK}\n\ntwo.\n\n${BLOCK}`;
	const { cleaned, blocks } = extractStatusBarBlocks(text);
	assert.equal(cleaned.includes("Status_block"), false);
	assert.equal(blocks.length, 2);
});

test("unclosed block not stripped", () => {
	const text = `start\n<Status_block>\n[HEAD]\nno close\nmore prose`;
	const { cleaned, blocks } = extractStatusBarBlocks(text);
	assert.equal(blocks.length, 0);
	assert.equal(cleaned.includes("more prose"), true);
});

test("parse: head + fields", () => {
	const snap = parseStatusBarBlock(BLOCK);
	assert.equal(snap.head, "[HEAD line 1 | HEAD line 2]");
	const labels = snap.fields.map((f) => f.label);
	assert.ok(labels.includes("[name]"));
	assert.ok(labels.includes("[action]"));
	const fans = snap.fields.find((f) => f.label === "[fans]");
	assert.equal(fans?.value, "285k");
	const diary = snap.fields.find((f) => f.label === "[diary]");
	assert.ok(diary);
	const time = snap.fields.find((f) => f.label === "[time]");
	assert.equal(time?.value, "2min ago");
});

test("latest snapshot picks last block", () => {
	const text = `one.\n\n${BLOCK}\n\ntwo.\n\n${BLOCK}`;
	const snap = latestStatusBarSnapshot(text);
	assert.ok(snap);
	assert.equal(snap?.head, "[HEAD line 1 | HEAD line 2]");
});

test("no block -> null", () => {
	assert.equal(latestStatusBarSnapshot("plain prose"), null);
	assert.equal(latestStatusBarSnapshot(""), null);
});

test("spelling variants", () => {
	const v1 = `<StatusBlock>\n[HEAD]\n<details><summary>s</summary>\n- [n] A\n</details>\n</StatusBlock>`;
	const v2 = v1.replace("StatusBlock", "status_block");
	assert.equal(stripStatusBarText(v1).includes("HEAD"), false);
	assert.equal(stripStatusBarText(v2).includes("HEAD"), false);
	assert.equal(latestStatusBarSnapshot(v1)?.fields[0]?.label, "[n] A");
});