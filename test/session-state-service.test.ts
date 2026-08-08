import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionStateService } from "../src/session-state-service.ts";
import { loadState } from "../src/state.ts";
import { loadMvuData } from "../src/mvu.ts";

test("Harness 状态服务串行提交 World State 和 MVU", async () => {
	const dir = mkdtempSync(join(tmpdir(), "liyuan-state-service-"));
	try {
		const service = new SessionStateService({ stateFile: join(dir, "state.json"), mvuFile: join(dir, "mvu.json"), knownCharacterNames: () => ["Alice"] });
		await Promise.all([
			service.patchWorldState({ characters: { alice: { status: "受伤" } } }, { source: "scribe" }),
			service.patchMvu([{ op: "insert", path: "/Alice/mood", value: "alert" }], { source: "side-agent" }),
		]);
		assert.equal(loadState(join(dir, "state.json")).characters.Alice?.status, "受伤");
		assert.equal((loadMvuData(join(dir, "mvu.json")).Alice as Record<string, unknown>).mood, "alert");
	} finally { rmSync(dir, { recursive: true, force: true }); }
});
