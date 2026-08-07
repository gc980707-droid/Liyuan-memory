import assert from "node:assert/strict";
import test from "node:test";
import { buildCardManifest } from "../src/card-manifest.ts";

test("生成跨卡通用 Card Manifest", () => {
	const manifest = buildCardManifest({ raw: { data: { name: "卡A", extensions: { regex_scripts: [], tavern_helper: { variables: {} } } } }, card: { name: "卡A", book: [] } as never, cardPath: "cards/a.png", lore: [], initialMvu: { stat_data: {} }, userName: "旅人" });
	assert.equal(manifest.cardName, "卡A");
	assert.equal(manifest.mvu.detected, true);
	assert.equal(manifest.capabilities.tavernHelper, true);
});

test("Manifest 不把卡标题和 user 当角色", () => {
	const manifest = buildCardManifest({ raw: { data: { name: "火车站上的臭福利姬们" } }, card: { name: "火车站上的臭福利姬们", book: [] } as never, cardPath: "cards/a.png", lore: [{ comment: "{{user}}" }] as never, userName: "旅人" });
	assert.deepEqual(manifest.characters, []);
});
