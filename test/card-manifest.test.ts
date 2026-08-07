import assert from "node:assert/strict";
import test from "node:test";
import { buildCardManifest } from "../src/card-manifest.ts";

test("生成跨卡通用 Card Manifest", () => {
	const manifest = buildCardManifest({ raw: { data: { name: "卡A", extensions: { regex_scripts: [], tavern_helper: { variables: {} } } } }, card: { name: "卡A", book: [] } as never, cardPath: "cards/a.png", lore: [], initialMvu: { stat_data: {} } });
	assert.equal(manifest.cardName, "卡A");
	assert.equal(manifest.mvu.detected, true);
	assert.equal(manifest.capabilities.tavernHelper, true);
});
