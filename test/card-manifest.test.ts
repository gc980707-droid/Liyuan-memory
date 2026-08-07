import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addManifestCharacterToLore, buildCardManifest, manifestAgentCharacters, promoteManifestCharacter, syncCardManifestCharacters } from "../src/card-manifest.ts";

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

test("Manifest 随世界书增删角色但保留既有运行配置", () => {
	const base = buildCardManifest({ raw: { data: { name: "卡A" } }, card: { name: "卡A", book: [] } as never, cardPath: "cards/a.png", lore: [{ comment: "苏小棉", keys: ["棉宝"], content: "人物资料" }] as never, userName: "旅人" });
	const configured = promoteManifestCharacter(base, "苏小棉", "core");
	const next = syncCardManifestCharacters(configured, {
		card: { name: "卡A" } as never,
		lore: [
			{ comment: "苏小棉", keys: ["棉宝"], content: "人物资料" },
			{ comment: "林夏", keys: ["夏夏"], content: "人物资料" },
		] as never,
		userName: "旅人",
	});
	assert.deepEqual(next.characters.map((character) => character.name), ["苏小棉", "林夏"]);
	assert.equal(next.characters[0].kind, "core");
	const removed = syncCardManifestCharacters(next, { card: { name: "卡A" } as never, lore: [{ comment: "林夏", keys: ["夏夏"], content: "人物资料" }] as never, userName: "旅人" });
	assert.deepEqual(removed.characters.map((character) => character.name), ["林夏"]);
});

test("世界书同步不改变角色卡格式适配信息", () => {
	const base = buildCardManifest({
		raw: { data: { name: "卡A", extensions: { regex_scripts: [{ find_regex: "x" }], tavern_helper: { variables: {} } } } },
		card: { name: "卡A" } as never,
		cardPath: "cards/a.png",
		lore: [],
		initialMvu: { status: { mood: "calm" } },
	});
	const next = syncCardManifestCharacters(base, {
		card: { name: "卡A" } as never,
		lore: [{ comment: "规则条目", keys: ["rule"], content: "A valid worldbook entry in any language." }] as never,
	});
	assert.deepEqual(next.status, base.status);
	assert.deepEqual(next.capabilities, base.capabilities);
	assert.deepEqual(next.mvu, base.mvu);
});
