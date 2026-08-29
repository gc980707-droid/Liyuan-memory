import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadActorProfileOverrides } from "../src/actor-profiles.ts";

test("独立角色档案只读取合法字段", () => {
	const cwd = mkdtempSync(join(tmpdir(), "liyuan-actors-"));
	writeFileSync(join(cwd, ".liyuan-actor-profiles.json"), JSON.stringify({ actors: {
		沈云熙: { identity: "母亲", knownFacts: ["有两个女儿"], privateState: "担心学费", blindSpots: ["不知道用户此刻的真实想法"], ignored: "drop" },
		坏数据: { knownFacts: "not-array" },
	} }));
	assert.deepEqual(loadActorProfileOverrides(cwd), { 沈云熙: { identity: "母亲", knownFacts: ["有两个女儿"], privateState: "担心学费", blindSpots: ["不知道用户此刻的真实想法"] } });
});
