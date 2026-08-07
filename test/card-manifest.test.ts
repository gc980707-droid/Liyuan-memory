import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addManifestCharacterToLore, buildCardManifest, manifestAgentCharacters, promoteManifestCharacter } from "../src/card-manifest.ts";

test("生成跨卡通用 Card Manifest", () => {
	const manifest = buildCardManifest({ raw: { data: { name: "卡A", extensions: { regex_scripts: [], tavern_helper: { variables: {} } } } }, card: { name: "卡A", book: [] } as never, cardPath: "cards/a.png", lore: [], initialMvu: { stat_data: {} }, userName: "旅人" });
	assert.equal(manifest.cardName, "卡A");
	assert.equal(manifest.mvu.detected, true);
	assert.equal(manifest.capabilities.tavernHelper, true);
});

test("新增常驻角色先写世界书再链接 Manifest", () => {
	const dir = mkdtempSync(join(tmpdir(), "liyuan-manifest-character-"));
	try {
		const book = join(dir, "book.json");
		const manifestFile = join(dir, "manifest.json");
		const base = buildCardManifest({ raw: { data: { name: "卡A" } }, card: { name: "卡A", book: [] } as never, cardPath: "cards/a.png", lore: [], userName: "旅人" });
		const next = addManifestCharacterToLore(base, manifestFile, book, { name: "列车员", description: "负责列车服务的常驻角色。" });
		assert.equal(next.characters.find((c) => c.name === "列车员")?.kind, "recurring");
		assert.ok(JSON.parse(readFileSync(book, "utf8")).entries.length === 1);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Manifest 角色可升级并按场景调度", () => {
	const base = buildCardManifest({ raw: { data: { name: "卡A" } }, card: { name: "卡A", book: [] } as never, cardPath: "cards/a.png", lore: [], userName: "旅人" });
	const next = promoteManifestCharacter(base, "林夏", "recurring");
	assert.deepEqual(manifestAgentCharacters(next, "林夏抬头"), ["林夏"]);
	assert.deepEqual(manifestAgentCharacters(next, "窗外风声"), []);
});

test("Manifest 不把卡标题和 user 当角色", () => {
	const manifest = buildCardManifest({ raw: { data: { name: "火车站上的臭福利姬们" } }, card: { name: "火车站上的臭福利姬们", book: [] } as never, cardPath: "cards/a.png", lore: [{ comment: "{{user}}" }] as never, userName: "旅人" });
	assert.deepEqual(manifest.characters, []);
});
