import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { memoryScopeId, memoryScopeRoot } from "../src/memory/config.ts";
import { cosine, embedTextLocal } from "../src/memory/embed.ts";
import {
	getMemoryStatus,
	formatMemoryIndex,
	inheritMemoryScope,
	memoryDeleteChunk,
	memoryImportText,
	memoryListChunks,
	memoryManualAdd,
	memoryRecallForTurn,
	memoryReembedScope,
	memorySearch,
	onNarrativeTurnEnd,
	updateMemoryConfig,
	updateStoreConfig,
} from "../src/memory/service.ts";
import { loadChunks, loadStoreIndex, splitTextChunks, upsertTexts } from "../src/memory/store.ts";

const scopeA = { sessionId: "sess-a", card: "assets/cards/hero.png" };
const scopeB = { sessionId: "sess-b", card: "assets/cards/hero.png" };
const scopeOtherCard = { sessionId: "sess-a", card: "assets/cards/other.png" };

test("embed local: 相似文本余弦更高", () => {
	const a = embedTextLocal("主角在圣魂村觉醒了镜子武魂");
	const b = embedTextLocal("陈默于圣魂村觉醒武魂，是一面镜子");
	const c = embedTextLocal("今天天气真好适合去海边游泳");
	assert.ok(cosine(a, b) > cosine(a, c));
});

test("splitTextChunks: 长文切开", () => {
	const parts = splitTextChunks("甲".repeat(1000), 300);
	assert.ok(parts.length >= 3);
});

test("memoryScopeId: 不同卡或不同会话 → 不同 id", () => {
	assert.notEqual(memoryScopeId(scopeA), memoryScopeId(scopeB));
	assert.notEqual(memoryScopeId(scopeA), memoryScopeId(scopeOtherCard));
	assert.equal(memoryScopeId(scopeA), memoryScopeId({ ...scopeA, card: "ASSETS/cards/hero.png" }));
});

test("memory: 默认库名 剧情/额外", () => {
	const cwd = mkdtempSync(join(tmpdir(), "liyuan-mem-name-"));
	try {
		const st = getMemoryStatus(cwd, scopeA);
		assert.equal(st.stores.find((s) => s.id === "narrative")?.name, "剧情数据库");
		assert.equal(st.stores.find((s) => s.id === "external")?.name, "额外数据库");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("memory: 额外库导入检索", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "liyuan-mem-"));
	try {
		updateMemoryConfig(cwd, { enabled: true, embedMode: "local" });
		updateStoreConfig(cwd, "external", { enabled: true });
		const imp = await memoryImportText(
			cwd,
			scopeA,
			"external",
			"第一章\n\n少年在山中修炼，习得吐纳之法。\n\n第二章\n\n他遇到了青梧仙子，约定三年后再见。",
			"demo.txt",
		);
		assert.ok(imp.added >= 1);
		const hits = await memorySearch(cwd, scopeA, "external", "青梧仙子 三年", 3);
		assert.ok(hits.length >= 1);
		assert.ok(hits[0]!.text.includes("青梧") || hits.some((h) => h.text.includes("青梧")));
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("memory: 禁止向剧情库导入", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "liyuan-mem-ban-"));
	try {
		updateMemoryConfig(cwd, { enabled: true, embedMode: "local" });
		await assert.rejects(
			() => memoryImportText(cwd, scopeA, "narrative", "不该写入剧情库的内容足够长", "x.txt"),
			/剧情数据库|不能手动/,
		);
		await assert.rejects(
			() => memoryManualAdd(cwd, scopeA, "手动也不该进剧情库的一段话", { storeId: "narrative" }),
			/剧情数据库|不能手动/,
		);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("memory: 剧情合并入库不每轮一条", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "liyuan-mem-n-"));
	try {
		updateMemoryConfig(cwd, { enabled: true, embedMode: "local" });
		updateStoreConfig(cwd, "narrative", { enabled: true, everyNTurns: 1 });
		const t1 = await onNarrativeTurnEnd(
			cwd,
			scopeA,
			"第一轮正文内容足够长用于入库测试：青梧在谷口等候旅人归来。",
		);
		assert.equal(t1.stored, true);
		assert.equal(t1.merged, false); // 首条
		const t2 = await onNarrativeTurnEnd(
			cwd,
			scopeA,
			"第二轮正文：旅人递上玉佩，两人约定三年后再见于青梧谷。",
		);
		assert.equal(t2.stored, true);
		assert.equal(t2.merged, true); // 并入上一条
		const chunks = loadChunks(cwd, scopeA, "narrative");
		assert.equal(chunks.length, 1, "两次应仍只有 1 条（合并）");
		assert.ok(chunks[0]!.text.includes("青梧"));
		assert.ok(chunks[0]!.text.includes("玉佩"));
		assert.ok((chunks[0]!.meta.mergeCount ?? 0) >= 2);

		// 另一会话看不到
		const hitsB = await memorySearch(cwd, scopeB, "narrative", "青梧 玉佩", 3);
		assert.equal(hitsB.length, 0);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("memory: 手动写入额外库 + 列表 + 删除单条", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "liyuan-mem-man-"));
	try {
		updateMemoryConfig(cwd, { enabled: true, embedMode: "local" });
		updateStoreConfig(cwd, "external", { enabled: true });
		const a = await memoryManualAdd(cwd, scopeA, "设定A：青梧仙子掌管谷中灵泉与千年古树。", {
			title: "设定A",
		});
		assert.ok(a.added >= 1);
		const b = await memoryManualAdd(cwd, scopeA, "设定B：魔尊九重封印埋在黑渊底层。", { title: "设定B" });
		assert.ok(b.added >= 1);
		const list = memoryListChunks(cwd, scopeA, "external");
		assert.ok(list.length >= 2);
		const id = list[0]!.id;
		assert.equal(await memoryDeleteChunk(cwd, scopeA, "external", id), true);
		const list2 = memoryListChunks(cwd, scopeA, "external");
		assert.equal(list2.length, list.length - 1);
		assert.ok(!list2.some((c) => c.id === id));
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("memory: 常驻目录覆盖所有启用库且作用域隔离", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "liyuan-mem-index-"));
	try {
		updateMemoryConfig(cwd, { enabled: true, embedMode: "local" });
		updateStoreConfig(cwd, "narrative", { enabled: true, everyNTurns: 1 });
		await onNarrativeTurnEnd(cwd, scopeA, "青梧在月下把玉佩交给旅人，约定三年后于谷口再见。旅人郑重收下。 ");
		await memoryManualAdd(cwd, scopeA, "黑渊底层封印着魔尊残魂，封印不可在月蚀之夜开启。", { title: "黑渊封印" });

		const index = await formatMemoryIndex(cwd, scopeA, "青梧 黑渊");
		assert.ok(index?.includes("剧情数据库"));
		assert.ok(index?.includes("青梧"));
		assert.ok(index?.includes("额外数据库"));
		assert.ok(index?.includes("黑渊封印"));
		assert.equal(await formatMemoryIndex(cwd, scopeB), null);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("memory: 万条目录的最早与最晚分段均可发现", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "liyuan-mem-large-index-"));
	try {
		updateMemoryConfig(cwd, { enabled: true, embedMode: "local" });
		updateStoreConfig(cwd, "external", { enabled: true, maxChunks: 20_000 });
		const texts = Array.from({ length: 10_000 }, (_, i) => `第${i + 1}楼记忆：编号 ${i + 1} 的长期事件与人物记录。`);
		await upsertTexts(
			cwd,
			scopeA,
			"external",
			texts,
			{ source: "import" },
			20_000,
			{ mode: "local", cloud: { baseUrl: "", apiKey: "", model: "" } },
		);
		const index = await formatMemoryIndex(cwd, scopeA, "第3楼", {
			maxChars: 20_000,
			segmentSize: 100,
			relevantItems: 5,
		});
		assert.ok(index?.includes("1-100/10000"), "最早分段必须常驻可发现");
		assert.ok(index?.includes("9901-10000/10000"), "最晚分段必须常驻可发现");
		assert.ok(index?.includes("第3楼"), "早期相关条目应能从全库展开");
		const started = performance.now();
		const second = await formatMemoryIndex(cwd, scopeA, "第9999楼", { maxChars: 7000 });
		assert.ok(second?.includes("第9999楼"));
		assert.ok(performance.now() - started < 1000, "持久化索引的热读取不应退化为全 JSONL 扫描");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("memory: 持久化索引随合并和删除保持一致", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "liyuan-mem-index-sync-"));
	try {
		updateMemoryConfig(cwd, { enabled: true, embedMode: "local" });
		await memoryManualAdd(cwd, scopeA, "旧约定：在白塔顶层会面。", { title: "白塔之约" });
		await memoryManualAdd(cwd, scopeA, "黑渊入口由银钥匙开启。", { title: "银钥匙" });
		let index = loadStoreIndex(cwd, scopeA, "external");
		assert.equal(index?.count, 2);
		const firstId = index!.items[0]!.id;
		assert.equal(await memoryDeleteChunk(cwd, scopeA, "external", firstId), true);
		index = loadStoreIndex(cwd, scopeA, "external");
		assert.equal(index?.count, 1);
		assert.ok(!index?.items.some((item) => item.id === firstId));
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("memory: 回档分支不会看到废弃分支记忆", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "liyuan-mem-branch-"));
	try {
		updateMemoryConfig(cwd, { enabled: true, embedMode: "local" });
		const oldBranch = { ...scopeA, leafId: "old-leaf", branchEntryIds: ["root", "old-leaf"] };
		const newBranch = { ...scopeA, leafId: "new-leaf", branchEntryIds: ["root", "new-leaf"] };
		await memoryManualAdd(cwd, oldBranch, "旧分支里青梧已经离开了山谷。", { title: "旧线离谷" });
		await memoryManualAdd(cwd, newBranch, "新分支里青梧仍留在山谷守候。", { title: "新线守候" });
		const index = await formatMemoryIndex(cwd, newBranch, "青梧 山谷");
		assert.ok(index?.includes("新线守候"));
		assert.ok(!index?.includes("旧线离谷"));
		const hits = await memoryRecallForTurn(cwd, newBranch, "青梧 山谷 守候");
		assert.ok(hits.some((hit) => hit.text.includes("仍留")));
		assert.ok(!hits.some((hit) => hit.text.includes("已经离开")));
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("memory: 剧情合并不会跨分支污染", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "liyuan-mem-narrative-branch-"));
	try {
		updateMemoryConfig(cwd, { enabled: true, embedMode: "local" });
		updateStoreConfig(cwd, "narrative", { enabled: true, everyNTurns: 1 });
		const oldBranch = { ...scopeA, leafId: "old-leaf", branchEntryIds: ["root", "old-leaf"] };
		const newBranch = { ...scopeA, leafId: "new-leaf", branchEntryIds: ["root", "new-leaf"] };
		await onNarrativeTurnEnd(cwd, oldBranch, "旧分支里青梧离开山谷，独自去了北境，此事已经发生。 ");
		await onNarrativeTurnEnd(cwd, newBranch, "新分支里青梧留在山谷，决定继续陪伴旅人。 ");
		const chunks = loadChunks(cwd, scopeA, "narrative");
		assert.equal(chunks.length, 2);
		assert.equal(chunks[0]!.meta.branchEntryId, "old-leaf");
		assert.equal(chunks[1]!.meta.branchEntryId, "new-leaf");
		const hits = await memoryRecallForTurn(cwd, newBranch, "青梧 山谷 陪伴");
		assert.ok(!hits.some((hit) => hit.text.includes("北境")));
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("memory: fork 继承当前祖先记忆并排除废弃分支", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "liyuan-mem-fork-"));
	try {
		updateMemoryConfig(cwd, { enabled: true, embedMode: "local" });
		const parentVisible = { sessionId: "parent", card: scopeA.card, leafId: "kept", branchEntryIds: ["root", "kept"] };
		const parentDiscarded = { sessionId: "parent", card: scopeA.card, leafId: "discarded", branchEntryIds: ["root", "discarded"] };
		await memoryManualAdd(cwd, parentVisible, "祖先记忆：白塔中保存着星盘。", { title: "白塔星盘" });
		await memoryManualAdd(cwd, parentDiscarded, "废弃记忆：银钥匙已经被摧毁。", { title: "钥匙摧毁" });
		const child = { sessionId: "child", card: scopeA.card, leafId: "kept", branchEntryIds: ["root", "kept"] };
		await inheritMemoryScope(cwd, { sessionId: "parent", card: scopeA.card }, child);
		const index = await formatMemoryIndex(cwd, child, "白塔 银钥匙");
		assert.ok(index?.includes("白塔星盘"));
		assert.ok(!index?.includes("钥匙摧毁"));
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("memory: 并发写入串行且同批重复去重", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "liyuan-mem-concurrent-"));
	try {
		updateMemoryConfig(cwd, { enabled: true, embedMode: "local" });
		await Promise.all([
			memoryManualAdd(cwd, scopeA, "并发记忆甲：白塔顶层藏有星盘。", { title: "白塔星盘" }),
			memoryManualAdd(cwd, scopeA, "并发记忆乙：黑渊入口需要银钥匙。", { title: "黑渊银钥" }),
		]);
		await upsertTexts(
			cwd,
			scopeA,
			"external",
			["重复条目：月蚀之夜封印减弱。", "重复条目：月蚀之夜封印减弱。"],
			{ source: "manual" },
			100,
			{ mode: "local", cloud: { baseUrl: "", apiKey: "", model: "" } },
		);
		const chunks = memoryListChunks(cwd, scopeA, "external");
		assert.equal(chunks.filter((chunk) => chunk.text.includes("重复条目")).length, 1);
		assert.ok(chunks.some((chunk) => chunk.text.includes("白塔")));
		assert.ok(chunks.some((chunk) => chunk.text.includes("黑渊")));
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("memory: 分片追加不重写历史分片", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "liyuan-mem-shards-"));
	try {
		updateMemoryConfig(cwd, { enabled: true, embedMode: "local" });
		const texts = Array.from({ length: 600 }, (_, i) => `分片测试第${i + 1}条：长期事件记录。`);
		await upsertTexts(cwd, scopeA, "external", texts, { source: "import" }, 1000, {
			mode: "local",
			cloud: { baseUrl: "", apiKey: "", model: "" },
		});
		const dir = join(memoryScopeRoot(cwd, scopeA), "stores", "external");
		const first = join(dir, "chunks-000000.jsonl");
		const second = join(dir, "chunks-000001.jsonl");
		const before = [statSync(first).mtimeMs, statSync(second).mtimeMs];
		await new Promise((resolve) => setTimeout(resolve, 20));
		await memoryManualAdd(cwd, scopeA, "新增第601条：只应改写最后一个分片。", { title: "增量追加" });
		assert.deepEqual([statSync(first).mtimeMs, statSync(second).mtimeMs], before);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("memory: 旧单文件自动迁移并保留备份", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "liyuan-mem-migrate-"));
	try {
		updateMemoryConfig(cwd, { enabled: true, embedMode: "local" });
		await memoryManualAdd(cwd, scopeA, "迁移来源记忆：青梧保管玉佩。", { title: "迁移测试" });
		const dir = join(memoryScopeRoot(cwd, scopeA), "stores", "external");
		const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { shards: Array<{ file: string }> };
		const legacy = join(dir, "chunks.jsonl");
		writeFileSync(legacy, readFileSync(join(dir, manifest.shards[0]!.file), "utf8"), "utf8");
		rmSync(join(dir, "manifest.json"));
		rmSync(join(dir, manifest.shards[0]!.file));
		const chunks = memoryListChunks(cwd, scopeA, "external");
		assert.equal(chunks.length, 1);
		assert.ok(existsSync(`${legacy}.legacy.bak`));
		assert.ok(existsSync(join(dir, "manifest.json")));
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("memory: recallForTurn 受 injectOnTurn 控制", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "liyuan-mem-r-"));
	try {
		updateMemoryConfig(cwd, { enabled: true, injectOnTurn: true, searchTopK: 3, embedMode: "local" });
		updateStoreConfig(cwd, "narrative", { enabled: true, everyNTurns: 1 });
		await onNarrativeTurnEnd(cwd, scopeA, "青梧在月下承诺永不离开旅人，并将玉佩相赠作为信物");
		const hits = await memoryRecallForTurn(cwd, scopeA, "青梧 玉佩 承诺");
		assert.ok(hits.length >= 1);
		updateMemoryConfig(cwd, { injectOnTurn: false });
		assert.equal((await memoryRecallForTurn(cwd, scopeA, "青梧 玉佩")).length, 0);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("memory: 配置云端字段不落明文到 public", () => {
	const cwd = mkdtempSync(join(tmpdir(), "liyuan-mem-c-"));
	try {
		updateMemoryConfig(cwd, {
			enabled: true,
			embedMode: "cloud",
			cloudEmbed: {
				baseUrl: "https://api.openai.com/v1",
				apiKey: "sk-secret-test",
				model: "text-embedding-3-small",
			},
		});
		const pub = getMemoryStatus(cwd, scopeA).config;
		assert.equal(pub.embedMode, "cloud");
		assert.equal(pub.cloudEmbedConfigured, true);
		assert.ok(pub.cloudEmbed.apiKey.includes("•") || pub.cloudEmbed.apiKey === "");
		assert.ok(!pub.cloudEmbed.apiKey.includes("sk-secret"));
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("memory: 重向量化保留原文", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "liyuan-mem-re-"));
	try {
		updateMemoryConfig(cwd, { enabled: true, embedMode: "local" });
		updateStoreConfig(cwd, "external", { enabled: true });
		await memoryImportText(
			cwd,
			scopeA,
			"external",
			"重向量化测试：青梧在月下把玉佩交给旅人，约好三年后于青梧谷再见。",
			"re.txt",
		);
		const before = loadChunks(cwd, scopeA, "external");
		assert.ok(before.length >= 1);
		const text0 = before[0]!.text;
		const r = await memoryReembedScope(cwd, scopeA);
		assert.ok(r.totalUpdated >= 1);
		const after = loadChunks(cwd, scopeA, "external");
		assert.equal(after[0]!.text, text0);
		assert.equal(after[0]!.meta.embedMode, "local");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
